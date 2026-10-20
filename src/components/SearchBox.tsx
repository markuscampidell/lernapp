import { Icon } from './Icon';
import { TextLine } from './TextLine';

export function SearchBox({ value, onChange, placeholder = 'Suchen' }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="search">
      <Icon name="search" size={18} />
      <TextLine
        role="searchbox"
        aria-label={placeholder}
        enterKeyHint="search"
        spellCheck={false}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        onEnter={() => (document.activeElement as HTMLElement | null)?.blur()}
      />
      {value && (
        <button className="icon-btn small" aria-label="Suche leeren" onClick={() => onChange('')}>
          <Icon name="close" size={16} />
        </button>
      )}
    </label>
  );
}
