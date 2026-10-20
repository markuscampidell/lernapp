import { Icon } from './Icon';

export function SearchBox({ value, onChange, placeholder = 'Suchen' }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="search">
      <Icon name="search" size={18} />
      <input
        type="search"
        name="search"
        autoComplete="off"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <button className="icon-btn small" aria-label="Suche leeren" onClick={() => onChange('')}>
          <Icon name="close" size={16} />
        </button>
      )}
    </label>
  );
}
