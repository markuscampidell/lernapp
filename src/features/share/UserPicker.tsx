import { useMemo, useState } from 'react';
import type { Profile } from '../../cloud/remote';
import { SearchBox } from '../../components/SearchBox';
import { Icon } from '../../components/Icon';

/** Personen (Benutzernamen) auswählen. */
export function UserPicker({ profiles, exclude, selected, onChange }: { profiles: Profile[]; exclude: Set<string>; selected: Set<string>; onChange: (s: Set<string>) => void }) {
  const [query, setQuery] = useState('');
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return profiles
      .filter((p) => !exclude.has(p.id) && (!q || p.username.toLowerCase().includes(q)))
      .sort((a, b) => a.username.localeCompare(b.username, 'de', { sensitivity: 'base' }));
  }, [profiles, exclude, query]);

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  };

  return (
    <div className="stack">
      <SearchBox value={query} onChange={setQuery} placeholder="Benutzername suchen" />
      {list.length === 0 ? (
        <p className="muted small">{query ? 'Niemand gefunden.' : 'Es gibt noch keine weiteren Personen. Sie müssen sich zuerst registrieren.'}</p>
      ) : (
        <div className="people people-scroll">
          {list.map((p) => (
            <button key={p.id} type="button" className={`person${selected.has(p.id) ? ' selected' : ''}`} onClick={() => toggle(p.id)} aria-pressed={selected.has(p.id)}>
              <span className="avatar">{selected.has(p.id) ? <Icon name="check" size={18} /> : p.username.slice(0, 1)}</span>
              <strong className="grow ellipsis">{p.username}</strong>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
