import { TextLine } from './TextLine';

/** Beschreibung einer Datei direkt im Editor (optional, erscheint in der Ordner-Liste unter dem Namen). */
export function DescriptionField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="field">
      <div className="field-label">
        <span>Beschreibung</span>
        <span className="muted small">optional</span>
      </div>
      <TextLine value={value} onChange={onChange} placeholder="Worum geht es?" maxLength={500} />
    </div>
  );
}
