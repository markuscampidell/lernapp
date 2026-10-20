import { useEffect, useMemo, useRef, useState } from 'react';
import type { FileItem } from '../../domain/types';
import { pathOf, subtreeIds } from '../../domain/tree';
import { useLibrary } from '../../state/Library';
import { navigate, replace } from '../../lib/router';
import { formatSize, fullName, isTouchDevice } from '../../lib/files';
import { Icon } from '../../components/Icon';
import { FileThumb, FolderThumb } from '../../components/Thumbs';
import { useAiSettings } from '../../ai/settings';
import { GeminiError, prepareSources, streamAnswer, type ChatTurn } from '../../ai/gemini';
import { Markdown } from '../../ai/Markdown';
import { FileViewer } from '../folders/FileViewer';
import { SourcePicker } from './SourcePicker';
import { getSession, msgId, updateSession, useSession, type Message } from './session';

const SUGGESTIONS = [
  'Fasse die Unterlagen kurz zusammen.',
  'Erstelle 5 Lernfragen mit Lösungen.',
  'Erkläre die wichtigsten Begriffe.',
  'Was sind die Kernaussagen?',
];

export function AiView({ initialFolderId }: { initialFolderId: string | null }) {
  const { folders, files } = useLibrary();
  const { apiKey, model } = useAiSettings();
  const session = useSession();
  const [picking, setPicking] = useState(false);
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState<FileItem | null>(null);
  const abort = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // Aus einem Ordner per "KI fragen" geöffnet: diesen Ordner als Quelle setzen.
  useEffect(() => {
    if (!initialFolderId) return;
    const s = getSession();
    if (folders.some((f) => f.id === initialFolderId) && !(s.folderIds.length === 1 && s.folderIds[0] === initialFolderId && s.fileIds.length === 0)) {
      updateSession({ folderIds: [initialFolderId], fileIds: [], messages: [], prepared: null });
    }
    replace('#ki');
  }, [initialFolderId, folders]);

  // Gelöschte Ordner/Dateien aus der Auswahl entfernen.
  const folderIds = session.folderIds.filter((id) => folders.some((f) => f.id === id));
  const fileIds = session.fileIds.filter((id) => files.some((f) => f.id === id));

  // Alle Dateien der Auswahl (Ordner inkl. Unterordner), sortiert nach Pfad.
  const sources = useMemo(() => {
    const inFolders = new Set<string>();
    folderIds.forEach((id) => subtreeIds(folders, id).forEach((x) => inFolders.add(x)));
    const chosen = new Set(fileIds);
    return files
      .filter((f) => chosen.has(f.id) || inFolders.has(f.folderId))
      .map((file) => ({ file, path: pathOf(folders, file.folderId).map((p) => p.name).join(' / ') }))
      .sort((a, b) => (a.path + '/' + a.file.name).localeCompare(b.path + '/' + b.file.name, 'de', { numeric: true }));
  }, [folderIds, fileIds, folders, files]);
  const totalSize = sources.reduce((s, x) => s + x.file.size, 0);
  const signature = sources.map((s) => `${s.file.id}:${s.file.updatedAt}`).join('|');

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [session.messages.length, session.messages[session.messages.length - 1]?.text.length]);

  const setSources = (fo: string[], fi: string[]) => {
    const changed = fo.join() !== folderIds.join() || fi.join() !== fileIds.join();
    updateSession(changed ? { folderIds: fo, fileIds: fi, messages: [], prepared: null } : { folderIds: fo, fileIds: fi });
    setPicking(false);
  };

  const patchMessage = (id: number, p: Partial<Message>) =>
    updateSession((s) => ({ messages: s.messages.map((m) => (m.id === id ? { ...m, ...p } : m)) }));

  const ask = async (question: string, opts: { retry?: boolean } = {}) => {
    const q = question.trim();
    if (!q || busy || !apiKey || !model || sources.length === 0) return;
    setBusy(true);
    setDraft('');
    let messages = getSession().messages.filter((m) => m.role !== 'error');
    if (!opts.retry) {
      messages = [...messages, { id: msgId(), role: 'user', text: q }];
    }
    const answer: Message = { id: msgId(), role: 'model', text: '', pending: true };
    updateSession({ messages: [...messages, answer] });

    const ctrl = new AbortController();
    abort.current = ctrl;
    try {
      // 1. Unterlagen vorbereiten (nur wenn sich die Auswahl geändert hat)
      let prepared = getSession().prepared;
      if (!prepared || prepared.signature !== signature) {
        const r = await prepareSources(apiKey, sources, (done, total, name) =>
          setStatus(done < total ? `Unterlagen werden vorbereitet … ${done + 1}/${total}${name ? ` · ${name}` : ''}` : null),
        );
        prepared = { signature, parts: r.parts, skipped: r.skipped, fileIds: sources.map((s) => s.file.id) };
        updateSession({ prepared });
        if (r.parts.length === 0) throw new GeminiError('Keine der gewählten Dateien kann von der KI gelesen werden.');
      }
      setStatus(null);

      // 2. Antwort streamen
      const history: ChatTurn[] = messages.filter((m) => m.role !== 'error').map((m) => ({ role: m.role as 'user' | 'model', text: m.text }));
      let text = '';
      for await (const chunk of streamAnswer(apiKey, model, prepared.parts, history, ctrl.signal)) {
        text += chunk;
        patchMessage(answer.id, { text });
      }
      patchMessage(answer.id, { pending: false });
    } catch (e) {
      setStatus(null);
      const aborted = ctrl.signal.aborted;
      const cur = getSession().messages.find((m) => m.id === answer.id);
      if (aborted && cur?.text) {
        patchMessage(answer.id, { pending: false, text: cur.text + '\n\n_(Abgebrochen)_' });
      } else {
        updateSession((s) => ({
          messages: s.messages
            .filter((m) => m.id !== answer.id)
            .concat({ id: msgId(), role: 'error', text: aborted ? 'Abgebrochen.' : e instanceof Error ? e.message : 'Unbekannter Fehler.' }),
        }));
      }
    } finally {
      abort.current = null;
      setBusy(false);
    }
  };

  const lastUser = [...session.messages].reverse().find((m) => m.role === 'user');
  const prepared = session.prepared?.signature === signature ? session.prepared : null;

  const sourceChip = (n: number, extra: string, key: string) => {
    const id = prepared?.fileIds[n - 1] ?? sources[n - 1]?.file.id;
    const f = id ? files.find((x) => x.id === id) : undefined;
    if (!f) return <span key={key} className="cite">[Quelle {n}{extra ? `, ${extra}` : ''}]</span>;
    return (
      <button key={key} className="cite" onClick={() => setViewing(f)} title={`${fullName(f)} öffnen`}>
        <Icon name="file" size={13} /> {f.name}
        {extra ? `, ${extra}` : ''}
      </button>
    );
  };

  if (!apiKey) {
    return (
      <section className="view">
        <header className="view-header">
          <h1>KI</h1>
        </header>
        <div className="card ai-card">
          <span className="ai-icon">
            <Icon name="ai" size={28} />
          </span>
          <h2>Fragen zu deinen Unterlagen</h2>
          <p className="muted">
            Wähle einen Ordner oder Dateien und stelle Fragen dazu. Die KI (Google Gemini) antwortet nur mit Informationen aus
            deinen Dateien und zeigt, woher die Antwort stammt.
          </p>
          <p className="muted small">Dafür brauchst du einmalig einen kostenlosen Gemini-Schlüssel von Google.</p>
          <button className="btn primary" onClick={() => navigate('#einstellungen')}>
            Schlüssel in den Einstellungen eintragen
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="view ai-view">
      <header className="view-header">
        <h1>KI</h1>
        {session.messages.length > 0 && (
          <button className="btn ghost small" onClick={() => updateSession({ messages: [] })} disabled={busy}>
            <Icon name="refresh" size={16} /> Neues Gespräch
          </button>
        )}
      </header>

      <div className="card sources-card">
        <div className="sources-head">
          <strong>Unterlagen</strong>
          <button className="link" onClick={() => setPicking(true)} disabled={busy}>
            {sources.length ? 'Ändern' : 'Auswählen'}
          </button>
        </div>
        {sources.length === 0 ? (
          <button className="empty source-empty" onClick={() => setPicking(true)}>
            <span className="empty-title">Ordner oder Dateien wählen</span>
            <span className="muted small">Die KI beantwortet Fragen nur aus diesen Unterlagen.</span>
          </button>
        ) : (
          <>
            <div className="chips">
              {folderIds.map((id) => {
                const f = folders.find((x) => x.id === id)!;
                return (
                  <span key={id} className="chip source-chip">
                    <FolderThumb folder={f} /> {f.name}
                    <button aria-label={`${f.name} entfernen`} disabled={busy} onClick={() => setSources(folderIds.filter((x) => x !== id), fileIds)}>
                      <Icon name="close" size={14} />
                    </button>
                  </span>
                );
              })}
              {fileIds.map((id) => {
                const f = files.find((x) => x.id === id)!;
                return (
                  <span key={id} className="chip source-chip">
                    <FileThumb file={f} /> {fullName(f)}
                    <button aria-label={`${fullName(f)} entfernen`} disabled={busy} onClick={() => setSources(folderIds, fileIds.filter((x) => x !== id))}>
                      <Icon name="close" size={14} />
                    </button>
                  </span>
                );
              })}
            </div>
            <p className="muted small">
              {sources.length} Datei{sources.length === 1 ? '' : 'en'} · {formatSize(totalSize)}
              {prepared && prepared.skipped.length > 0 && ` · nicht lesbar: ${prepared.skipped.join(', ')}`}
            </p>
          </>
        )}
      </div>

      {sources.length > 0 && session.messages.length === 0 && (
        <div className="suggestions">
          {SUGGESTIONS.map((s) => (
            <button key={s} className="chip suggestion" onClick={() => ask(s)} disabled={busy}>
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="chat">
        {session.messages.map((m) =>
          m.role === 'user' ? (
            <div key={m.id} className="bubble user">
              {m.text}
            </div>
          ) : m.role === 'error' ? (
            <div key={m.id} className="bubble error">
              <span>{m.text}</span>
              {lastUser && (
                <button className="btn ghost small" onClick={() => ask(lastUser.text, { retry: true })} disabled={busy}>
                  Nochmal versuchen
                </button>
              )}
            </div>
          ) : (
            <div key={m.id} className={`bubble model${m.pending ? ' pending' : ''}`}>
              {m.text ? <Markdown text={m.text} renderSource={sourceChip} /> : <span className="typing" aria-label="Antwort wird geschrieben"><i /><i /><i /></span>}
            </div>
          ),
        )}
        {status && <p className="muted small chat-status">{status}</p>}
        <div ref={endRef} />
      </div>

      {sources.length > 0 && (
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            ask(draft);
          }}
        >
          <textarea
            rows={1}
            value={draft}
            placeholder="Frage zu deinen Unterlagen …"
            aria-label="Frage"
            enterKeyHint={isTouchDevice ? 'enter' : 'send'}
            onChange={(e) => {
              setDraft(e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !isTouchDevice) {
                e.preventDefault();
                ask(draft);
              }
            }}
          />
          {busy ? (
            <button type="button" className="icon-btn send" aria-label="Stopp" onClick={() => abort.current?.abort()}>
              <Icon name="stop" />
            </button>
          ) : (
            <button type="submit" className="icon-btn send" aria-label="Senden" disabled={!draft.trim()}>
              <Icon name="send" />
            </button>
          )}
        </form>
      )}

      {picking && <SourcePicker folderIds={folderIds} fileIds={fileIds} onDone={setSources} onClose={() => setPicking(false)} />}
      {viewing && <FileViewer file={viewing} onClose={() => setViewing(null)} />}
    </section>
  );
}
