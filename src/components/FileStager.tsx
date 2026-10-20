import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import { TextLine } from './TextLine';
import { kindIcon } from './Thumbs';
import { formatSize, kindOf, KIND_LABEL, splitName } from '../lib/files';

export interface StagedFile {
  key: string;
  file: File;
  name: string;
  description: string;
  /** Erweitert, um die Beschreibung einzugeben. */
  open?: boolean;
}

let counter = 0;
export const stage = (files: Iterable<File>): StagedFile[] =>
  [...files].map((file) => ({ key: `s${++counter}`, file, name: splitName(file.name).name, description: '' }));

/** Liste ausgewählter Dateien: Namen und Beschreibungen vor dem Speichern anpassen. */
export function FileStager({ items, onChange, disabled }: { items: StagedFile[]; onChange: (next: StagedFile[]) => void; disabled?: boolean }) {
  const patch = (key: string, p: Partial<StagedFile>) => onChange(items.map((i) => (i.key === key ? { ...i, ...p } : i)));

  return (
    <ul className="list">
      {items.map((it) => {
        const { ext } = splitName(it.file.name);
        const kind = kindOf(it.file.type, ext);
        return (
          <li key={it.key} className="card staged">
            <div className="staged-head">
              <StagedThumb file={it.file} icon={kindIcon(kind)} isImage={kind === 'image'} />
              <div className="staged-name">
                <div className="input-row">
                  <TextLine
                    aria-label="Dateiname"
                    value={it.name}
                    disabled={disabled}
                    onChange={(v) => patch(it.key, { name: v })}
                    placeholder="Name"
                    enterKeyHint="done"
                    onEnter={() => (document.activeElement as HTMLElement | null)?.blur()}
                  />
                  {ext && <span className="unit">.{ext}</span>}
                </div>
                <span className="muted small">
                  {KIND_LABEL[kind]} · {formatSize(it.file.size)}
                  {!it.open && (
                    <>
                      {' · '}
                      <button className="link" disabled={disabled} onClick={() => patch(it.key, { open: true })}>
                        {it.description ? 'Beschreibung bearbeiten' : '+ Beschreibung'}
                      </button>
                    </>
                  )}
                </span>
              </div>
              <button className="icon-btn" aria-label="Entfernen" disabled={disabled} onClick={() => onChange(items.filter((i) => i.key !== it.key))}>
                <Icon name="close" size={18} />
              </button>
            </div>
            {it.open && (
              <textarea
                rows={2}
                autoFocus
                placeholder="Beschreibung (optional)"
                value={it.description}
                disabled={disabled}
                onChange={(e) => patch(it.key, { description: e.target.value })}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

function StagedThumb({ file, icon, isImage }: { file: File; icon: ReturnType<typeof kindIcon>; isImage: boolean }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!isImage) return;
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file, isImage]);
  return <span className="thumb file-thumb">{url ? <img src={url} alt="" onError={() => setUrl(undefined)} /> : <Icon name={icon} size={22} />}</span>;
}
