import type { ReactNode } from 'react';

/**
 * Kleiner, sicherer Markdown-Renderer für KI-Antworten (kein innerHTML).
 * Unterstützt Überschriften, Listen, Code-Blöcke, **fett**, *kursiv*, `code` und Quellenangaben [Quelle N, …].
 */
export function Markdown({ text, renderSource }: { text: string; renderSource?: (n: number, extra: string, key: string) => ReactNode }) {
  const lines = text.replace(/\r/g, '').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  let k = 0;
  const inl = (s: string) => inline(s, renderSource, `${k++}`);

  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++]);
      i++;
      blocks.push(
        <pre key={k++} className="md-code">
          {code.join('\n')}
        </pre>,
      );
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const level = Math.min(h[1].length + 2, 6);
      const Tag = `h${level}` as 'h3';
      blocks.push(<Tag key={k++}>{inl(h[2])}</Tag>);
      i++;
      continue;
    }
    if (/^\s*([-*•]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) {
        let item = lines[i].replace(/^\s*([-*•]|\d+[.)])\s+/, '');
        i++;
        // Fortsetzungszeilen (eingerückt) gehören zum Punkt
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) item += ' ' + lines[i++].trim();
        items.push(item);
      }
      const List = ordered ? 'ol' : 'ul';
      blocks.push(
        <List key={k++}>
          {items.map((it, j) => (
            <li key={j}>{inl(it)}</li>
          ))}
        </List>,
      );
      continue;
    }
    if (!line.trim()) {
      i++;
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^```|^#{1,4}\s|^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) para.push(lines[i++]);
    blocks.push(<p key={k++}>{inl(para.join('\n'))}</p>);
  }
  return <div className="md">{blocks}</div>;
}

function inline(s: string, renderSource: ((n: number, extra: string, key: string) => ReactNode) | undefined, prefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*|_[^_\s][^_]*_|\[Quelle\s+(\d+)([^\]]*)\])/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    const t = m[0];
    const key = `${prefix}-${n++}`;
    if (m[2]) out.push(renderSource ? renderSource(Number(m[2]), m[3].replace(/^[,\s]+/, ''), key) : t);
    else if (t.startsWith('**')) out.push(<strong key={key}>{t.slice(2, -2)}</strong>);
    else if (t.startsWith('`')) out.push(<code key={key}>{t.slice(1, -1)}</code>);
    else out.push(<em key={key}>{t.slice(1, -1)}</em>);
    last = m.index + t.length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}
