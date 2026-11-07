import { useEffect, useState } from 'react';
import type { FileItem } from '../../domain/types';
import { useLibrary } from '../../state/Library';
import { Avatar } from '../../components/Avatar';
import { Icon } from '../../components/Icon';
import { describe } from './diff';

const ago = (iso: string) => {
  const min = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (min < 60) return min <= 1 ? 'gerade eben' : `vor ${min} Min.`;
  const h = Math.round(min / 60);
  if (h < 24) return `vor ${h} Std.`;
  const d = Math.round(h / 24);
  return d === 1 ? 'gestern' : `vor ${d} Tagen`;
};

/** Beim Öffnen einmal zeigen, was andere seit dem letzten Mal geändert haben – danach gilt es als gesehen. */
export function ChangesBanner({ file }: { file: FileItem }) {
  const { changesFor, markChangesSeen, userName } = useLibrary();
  // Beim Öffnen festhalten (danach verschwindet es aus der Liste, hier bleibt es bis zum Schließen).
  const [changes] = useState(() => changesFor(file.id));
  useEffect(() => {
    if (changes.length) markChangesSeen(file.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!changes.length) return null;
  return (
    <div className="card changes-banner" role="status">
      <strong className="changes-title">
        <Icon name="edit" size={16} /> Seit du zuletzt hier warst
      </strong>
      {changes.map((c) => (
        <div key={c.userId ?? '?'} className="changes-row">
          <Avatar id={c.userId} />
          <div className="card-main">
            <span>
              <strong>{userName(c.userId)}</strong> {ago(c.at)}
            </span>
            <span className="muted small">{describe(c.parts)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
