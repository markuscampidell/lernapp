import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FileItem } from '../../domain/types';
import { useLibrary } from '../../state/Library';
import { Avatar } from '../../components/Avatar';
import { Icon } from '../../components/Icon';
import { supabase } from '../../cloud/supabase';
import { addComment, deleteComment, fetchComments, type Comment } from '../../cloud/remote';

const MAX = 4000;

function ago(iso: string): string {
  const t = Date.parse(iso);
  const min = Math.round((Date.now() - t) / 60_000);
  if (min < 1) return 'gerade eben';
  if (min < 60) return `vor ${min} Min.`;
  const h = Math.round(min / 60);
  if (h < 24) return `vor ${h} Std.`;
  const d = Math.round(h / 24);
  if (d < 7) return d === 1 ? 'gestern' : `vor ${d} Tagen`;
  return new Date(t).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/**
 * Kommentare unter einer Datei (nur für Dateien auf dem Server: geteilt oder „Auf allen Geräten“).
 * Alle, die die Datei sehen, können kommentieren und antworten; löschen kann man eigene, der Besitzer alle.
 */
export function Comments({ file }: { file: FileItem }) {
  const { me, userName, online, isOwner, markCommentsRead, refreshRemote } = useLibrary();
  const [list, setList] = useState<Comment[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const owner = isOwner(file.shareId);

  const load = useCallback(async () => {
    try {
      setList(await fetchComments(file.id));
      setErr(null);
      markCommentsRead(file.id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Kommentare konnten nicht geladen werden.');
    }
  }, [file.id, markCommentsRead]);

  useEffect(() => {
    load();
  }, [load]);

  // Live: neue Kommentare von anderen sofort zeigen.
  useEffect(() => {
    if (!supabase) return;
    const client = supabase;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const channel = client
      .channel(`comments-${file.id}-${Math.random().toString(36).slice(2, 8)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'comments', filter: `file_id=eq.${file.id}` }, () => {
        clearTimeout(timer);
        timer = setTimeout(load, 250);
      })
      .subscribe();
    return () => {
      clearTimeout(timer);
      client.removeChannel(channel);
    };
  }, [file.id, load]);

  const threads = useMemo(() => {
    const all = list ?? [];
    const top = all.filter((c) => !c.parentId || !all.some((p) => p.id === c.parentId));
    return top.map((c) => ({ c, replies: all.filter((r) => r.parentId === c.id) }));
  }, [list]);

  const send = async () => {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await addComment(file.id, body.slice(0, MAX), replyTo?.id ?? null);
      setText('');
      setReplyTo(null);
      await load();
      refreshRemote(); // Anzahl in Liste/Kopfzeile
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Senden hat nicht geklappt.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (c: Comment) => {
    if (!confirm('Diesen Kommentar löschen?' + (threads.find((t) => t.c.id === c.id)?.replies.length ? ' Die Antworten darauf werden mitgelöscht.' : ''))) return;
    try {
      await deleteComment(c.id);
      await load();
      refreshRemote();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Löschen hat nicht geklappt.');
    }
  };

  const item = (c: Comment, reply = false) => (
    <div key={c.id} className={`comment${reply ? ' reply' : ''}`}>
      <Avatar id={c.userId} />
      <div className="comment-main">
        <div className="comment-head">
          <strong>{c.userId === me?.id ? 'Du' : userName(c.userId)}</strong>
          <span className="muted small">{ago(c.createdAt)}</span>
        </div>
        <p className="comment-body">{c.body}</p>
        <div className="comment-actions">
          {!reply && (
            <button
              className="link"
              onClick={() => {
                setReplyTo(c);
                setTimeout(() => input.current?.focus(), 0);
              }}
              disabled={!online}
            >
              Antworten
            </button>
          )}
          {(c.userId === me?.id || owner) && (
            <button className="link danger" onClick={() => remove(c)} disabled={!online}>
              Löschen
            </button>
          )}
        </div>
      </div>
    </div>
  );

  const count = list?.length ?? 0;
  return (
    <section className="comments card" aria-label="Kommentare">
      <h3 className="comments-title">
        <Icon name="comment" size={18} /> Kommentare{count ? ` (${count})` : ''}
      </h3>
      {list === null && !err && <p className="muted small">Lädt …</p>}
      {list && count === 0 && <p className="muted small">Noch keine Kommentare. Frag etwas oder schreib einen Hinweis – alle, die diese Datei sehen, können antworten.</p>}
      {threads.map(({ c, replies }) => (
        <div key={c.id} className="comment-thread">
          {item(c)}
          {replies.map((r) => item(r, true))}
        </div>
      ))}
      {err && <p className="notice warning">{err}</p>}
      <div className="comment-form">
        {replyTo && (
          <div className="comment-replying muted small">
            Antwort an {replyTo.userId === me?.id ? 'dich' : userName(replyTo.userId)}
            <button className="icon-btn small" aria-label="Antwort abbrechen" onClick={() => setReplyTo(null)}>
              <Icon name="close" size={14} />
            </button>
          </div>
        )}
        <textarea
          ref={input}
          rows={2}
          value={text}
          maxLength={MAX}
          placeholder={online ? (replyTo ? 'Antwort schreiben …' : 'Kommentar schreiben …') : 'Offline – Kommentieren geht gerade nicht'}
          disabled={!online || busy}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button className="btn primary small" onClick={send} disabled={!text.trim() || busy || !online}>
          {busy ? 'Sendet …' : 'Senden'}
        </button>
      </div>
    </section>
  );
}
