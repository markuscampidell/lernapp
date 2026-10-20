import type { TextareaHTMLAttributes } from 'react';

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange' | 'rows'> & {
  value: string;
  onChange: (value: string) => void;
  /** Wird bei der Eingabetaste ausgelöst (statt eines Zeilenumbruchs). */
  onEnter?: () => void;
};

/**
 * Einzeiliges Textfeld.
 *
 * Absichtlich ein <textarea> statt <input>: Browser und Passwort-Manager (z. B. Google auf Android)
 * halten einzelne <input>-Felder oft für Benutzernamen und schlagen dann Passkeys/Passwörter vor.
 * Ein Textfeld vom Typ textarea wird nie als Anmeldefeld behandelt.
 */
export function TextLine({ value, onChange, onEnter, className, onKeyDown, ...rest }: Props) {
  return (
    <textarea
      {...rest}
      rows={1}
      className={`text-line${className ? ` ${className}` : ''}`}
      value={value}
      autoComplete="off"
      data-1p-ignore="true"
      data-lpignore="true"
      data-bwignore="true"
      data-form-type="other"
      onChange={(e) => onChange(e.target.value.replace(/[\r\n]+/g, ' '))}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          onEnter?.();
        }
        onKeyDown?.(e);
      }}
    />
  );
}
