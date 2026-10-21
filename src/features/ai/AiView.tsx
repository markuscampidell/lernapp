import { useEffect, useMemo, useRef, useState } from 'react';
import type { FileItem } from '../../domain/types';
import { pathOf, subtreeIds } from '../../domain/tree';
import { useLibrary } from '../../state/Library';
import { replace } from '../../lib/router';
import { formatSize, fullName, isTouchDevice } from '../../lib/files';
import { Icon } from '../../components/Icon';
import { FileThumb, FolderThumb } from '../../components/Thumbs';
import { Markdown } from '../../ai/Markdown';
import { FileViewer } from '../folders/FileViewer';
import { SourcePicker } from './SourcePicker';
import { QuizPanel } from './QuizPanel';
import { ask, cancel } from './runner';
import { getSession, updateSession, useSession, type SourceRef } from './session';

const SUGGESTIONS = ['Fasse die Unterlagen kurz zusammen.', 'Was sind die wichtigsten Begriffe?', 'Was sind die Kernaussagen?'];

export function AiView({ initialFolderId }: { initialFolderId: string | null }) {
  const { folders, files } = useLibrary();
  const session = useSession();
  const [picking, setPicking] = useState(false);
  const [draft, setDraft] = useState('');
  const [viewing, setViewing] = useState<FileItem | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const { busy, status, mode } = session;

  // Aus einem Ordner per "KI fragen" geöffnet: diesen Ordner als Quelle setzen.
  useEffect(() => {
    if (!initialFolderId) return;
    const s = getSession();
    if (
      !s.busy &&
      folders.some((f) => f.id === initialFolderId) &&
      !(s.folderIds.length === 1 && s.folderIds[0] === initialFolderId && s.fileIds.length === 0)
    ) {
      updateSession({ folderIds: [initialFolderId], fileIds: [], messages: [], quiz: null, unreadable: [] });
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
  }, [folderIds.join(), fileIds.join(), folders, files]); // eslint-disable-line react-hooks/exhaustive-deps
  const sourceFiles = sources.map((s) => s.file);
  const totalSize = sourceFiles.reduce((s, f) => s + f.size, 0);

  useEffect(() => {
    if (mode === 'chat') endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [mode, session.messages.length, session.messages[session.messages.length - 1]?.text.length]);

  const setSources = (fo: string[], fi: string[]) => {
    const changed = fo.join() !== folderIds.join() || fi.join() !== fileIds.join();
    updateSession(changed ? { folderIds: fo, fileIds: fi, messages: [], quiz: null, unreadable: [] } : { folderIds: fo, fileIds: fi });
    setPicking(false);
  };

  const send = (text: string) => {
    if (!text.trim() || busy) return;
    setDraft('');
    ask(text, sourceFiles);
  };

  const sourceChip = (s: SourceRef | undefined, key: string, fallback?: string) => {
    const f = s ? files.find((x) => x.id === s.fileId) : undefined;
    if (!f || !s) return <span key={key} className="cite">{fallback ?? 'Quelle'}</span>;
    return (
      <button key={key} className="cite" onClick={() => setViewing(f)} title={`${fullName(f)} öffnen`}>
        <Icon name="file" size={13} /> {f.name}
        {s.loc ? `, ${s.loc}` : ''}
      </button>
    );
  };

  const lastUser = [...session.messages].reverse().find((m) => m.role === 'user');

  return (
    <section className="view ai-view">
      <header className="view-header">
        <h1>KI</h1>
        {mode === 'chat' && session.messages.length > 0 && (
          <button className="btn ghost small" onClick={() => updateSession({ messages: [] })} disabled={busy}>
            <Icon name="refresh" size={16} /> Neues Gespräch
          </button>
        )}
      </header>

      <>
        <div className="segmented mode-switch">
          <button className={mode === 'chat' ? 'on' : ''} onClick={() => updateSession({ mode: 'chat' })}>
            Fragen
          </button>
          <button className={mode === 'quiz' ? 'on' : ''} onClick={() => updateSession({ mode: 'quiz' })}>
            Quiz
          </button>
        </div>

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
              <span className="muted small">Die KI arbeitet nur mit diesen Unterlagen. Ihr Text wird dafür an Google Gemini gesendet.</span>
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
              </p>
              {session.unreadable.length > 0 && (
                <details className="unreadable">
                  <summary className="muted small">{session.unreadable.length} Datei(en) kann die KI nicht lesen</summary>
                  <ul className="muted small">
                    {session.unreadable.map((u) => (
                      <li key={u.name}>
                        {u.name} – {u.reason}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}
        </div>

        {mode === 'quiz' ? (
          sources.length > 0 && <QuizPanel files={sourceFiles} renderSource={(s, key) => sourceChip(s, key)} />
        ) : (
          <>
            {sources.length > 0 && session.messages.length === 0 && (
              <div className="suggestions">
                {SUGGESTIONS.map((s) => (
                  <button key={s} className="chip suggestion" onClick={() => send(s)} disabled={busy}>
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
                      <button className="btn ghost small" onClick={() => ask(lastUser.text, sourceFiles, { retry: true })} disabled={busy}>
                        Nochmal versuchen
                      </button>
                    )}
                  </div>
                ) : (
                  <div key={m.id} className={`bubble model${m.pending ? ' pending' : ''}`}>
                    {m.text ? (
                      <Markdown text={m.text} renderSource={(n, extra, key) => sourceChip(m.sources?.[n - 1], key, `Quelle ${n}${extra ? `, ${extra}` : ''}`)} />
                    ) : (
                      <span className="typing" aria-label="Antwort wird geschrieben">
                        <i />
                        <i />
                        <i />
                      </span>
                    )}
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
                  send(draft);
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
                      send(draft);
                    }
                  }}
                />
                {busy ? (
                  <button type="button" className="icon-btn send" aria-label="Stopp" onClick={cancel}>
                    <Icon name="stop" />
                  </button>
                ) : (
                  <button type="submit" className="icon-btn send" aria-label="Senden" disabled={!draft.trim()}>
                    <Icon name="send" />
                  </button>
                )}
              </form>
            )}
          </>
        )}
      </>

      {picking && <SourcePicker folderIds={folderIds} fileIds={fileIds} onDone={setSources} onClose={() => setPicking(false)} />}
      {viewing && <FileViewer file={viewing} onClose={() => setViewing(null)} />}
    </section>
  );
}
