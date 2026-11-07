// Antworten einer KI (ChatGPT, Claude, Gemini …) einlesen.
// KIs halten sich selten 100 % an ein Format: Sie packen JSON in ```-Blöcke, schreiben Sätze davor/danach,
// lassen Kommas stehen oder vergessen, in LaTeX-Formeln den Backslash zu verdoppeln. Das wird hier repariert.
import { parseMath } from '../../lib/math';

/** Text zwischen dem ersten ```-Block (falls vorhanden), sonst der ganze Text. */
export function unfence(text: string): string {
  const t = text.replace(/\r\n?/g, '\n').trim();
  const open = t.match(/^(`{3,}|~{3,})[^\n]*\n/m);
  if (!open || open.index === undefined) return t;
  const fence = open[1];
  const start = open.index + open[0].length;
  // Bis zum letzten schließenden Zaun derselben Art (innen dürfen weitere Blöcke stehen).
  const closeRe = new RegExp(`\\n${fence[0] === '`' ? '`' : '~'}{${fence.length},}[ \\t]*(?:\\n|$)`, 'g');
  let end = -1;
  for (let m = closeRe.exec(t); m; m = closeRe.exec(t)) if (m.index >= start - 1) end = m.index;
  return end > start ? t.slice(start, end) : t.slice(start);
}

/** Inhalt eines JSON-Strings (zwischen den Anführungszeichen) reparieren. */
function fixStringBody(body: string): string {
  let out = '';
  let inMath = false;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '\\') {
      const n = body[i + 1];
      if (n === undefined) {
        out += '\\\\';
        continue;
      }
      if (n === '\\' || n === '"') {
        out += c + n;
        i++;
        continue;
      }
      // \$ = normales Dollarzeichen (kein Formelanfang)
      if (n === '$') {
        out += '\\\\$';
        i++;
        continue;
      }
      // In Formeln ist ein einzelner Backslash fast immer LaTeX (\frac, \beta, \nu, \theta …) – nie \f, \b, \n, \t.
      if (inMath) {
        out += '\\\\';
        continue;
      }
      if (n === 'u' && /^[0-9a-fA-F]{4}$/.test(body.slice(i + 2, i + 6))) {
        out += body.slice(i, i + 6);
        i += 5;
        continue;
      }
      // Außerhalb von Formeln sind \n, \t usw. als Steuerzeichen gemeint.
      if ('/bfnrt'.includes(n)) {
        out += c + n;
        i++;
        continue;
      }
      out += '\\\\';
      continue;
    }
    if (c === '$') {
      inMath = !inMath;
      if (body[i + 1] === '$') {
        out += '$$';
        i++;
        continue;
      }
    }
    if (c === '\n') {
      out += '\\n';
      continue;
    }
    if (c === '\t') {
      out += '\\t';
      continue;
    }
    out += c;
  }
  return out;
}

/** Übliche Fehler in KI-JSON reparieren (Backslashes, Zeilenumbrüche in Strings, Kommas am Ende, typografische Anführungszeichen). */
export function repairJson(raw: string): string {
  let out = '';
  let i = 0;
  while (i < raw.length) {
    const c = raw[i];
    if (c === '"') {
      let j = i + 1;
      while (j < raw.length) {
        if (raw[j] === '\\') {
          j += 2;
          continue;
        }
        if (raw[j] === '"') break;
        j++;
      }
      out += `"${fixStringBody(raw.slice(i + 1, j))}"`;
      i = j + 1;
      continue;
    }
    // Typografische Anführungszeichen als Schlüssel/Wert-Begrenzer
    if (c === '“' || c === '”' || c === '„') {
      out += '"';
      i++;
      continue;
    }
    out += c;
    i++;
  }
  // Kommas vor } oder ] entfernen
  return out.replace(/,(\s*[}\]])/g, '$1');
}

/** Sucht das JSON-Objekt in einer KI-Antwort und liest es ein. */
export function extractJson(text: string): Record<string, unknown> {
  const body = unfence(text);
  const tryFrom = (s: string) => {
    const a = s.indexOf('{');
    const b = s.lastIndexOf('}');
    if (a < 0 || b <= a) return null;
    const slice = s.slice(a, b + 1);
    for (const candidate of [repairJson(slice), slice]) {
      try {
        const v = JSON.parse(candidate);
        if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
      } catch {
        /* nächster Versuch */
      }
    }
    return null;
  };
  const found = tryFrom(body) ?? tryFrom(text);
  if (!found) {
    if (!/[{}]/.test(text)) throw new Error('In der Antwort steht kein JSON. Kopiere die komplette Antwort der KI (am besten mit dem „Kopieren“-Knopf am Codeblock).');
    throw new Error('Das JSON in der Antwort ist unvollständig oder kaputt. Ist die Antwort vielleicht abgeschnitten? Bitte die KI: „Schick das JSON nochmal vollständig in einem Codeblock.“');
  }
  return found;
}

// ---------- Markdown → Text-Dokument (HTML) ----------

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inlineMd(s: string): string {
  // Code zuerst schützen, dann Fett/Kursiv/Markiert/Links
  const codes: string[] = [];
  let t = s.replace(/`([^`]+)`/g, (_, c: string) => {
    codes.push(`<code>${esc(c)}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  t = esc(t)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.+?)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*(?!\s)(.+?)\*(?!\w)/g, '$1<em>$2</em>')
    .replace(/(^|[^_\w])_(?!\s)(.+?)_(?!\w)/g, '$1<em>$2</em>')
    .replace(/~~(.+?)~~/g, '<s>$1</s>')
    .replace(/==(.+?)==/g, '<mark>$1</mark>')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2">$1</a>');
  return t.replace(/\u0000(\d+)\u0000/g, (_, n: string) => codes[Number(n)]);
}

/** Text einer Zeile mit Formeln ($…$, $$…$$) und Markdown-Auszeichnung. */
function inline(s: string): string {
  return parseMath(s)
    .map((seg) =>
      seg.kind === 'math'
        ? `<span class="math" data-tex="${esc(seg.tex)}"${seg.display ? ' data-display="1"' : ''}></span>`
        : inlineMd(seg.text),
    )
    .join('');
}

interface ListItem {
  html: string;
  check: boolean;
  children: List | null;
}
interface List {
  ordered: boolean;
  check: boolean;
  indent: number;
  items: ListItem[];
}

function renderList(l: List): string {
  const tag = l.ordered ? 'ol' : 'ul';
  const cls = l.check ? ' class="checklist"' : '';
  return `<${tag}${cls}>${l.items.map((it) => `<li>${it.html}${it.children ? renderList(it.children) : ''}</li>`).join('')}</${tag}>`;
}

/** Wandelt (KI-)Markdown in das HTML der Text-Dokumente um. */
export function markdownToHtml(md: string): string {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let para: string[] = [];
  let stack: List[] = [];
  const flushPara = () => {
    if (para.length) out.push(`<p>${para.map(inline).join('<br>')}</p>`);
    para = [];
  };
  const flushList = () => {
    if (stack.length) out.push(renderList(stack[0]));
    stack = [];
  };
  const flush = () => {
    flushPara();
    flushList();
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Codeblock
    const fence = trimmed.match(/^(`{3,}|~{3,})/);
    if (fence) {
      flush();
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) code.push(lines[i++]);
      out.push(`<pre>${esc(code.join('\n'))}</pre>`);
      continue;
    }
    // Formel-Block über mehrere Zeilen: $$ … $$
    if (trimmed.startsWith('$$') && !(trimmed.length > 4 && trimmed.endsWith('$$'))) {
      flush();
      const tex: string[] = [trimmed.slice(2)];
      i++;
      while (i < lines.length && !lines[i].includes('$$')) tex.push(lines[i++]);
      if (i < lines.length) tex.push(lines[i].slice(0, lines[i].indexOf('$$')));
      const t = tex.join('\n').trim();
      if (t) out.push(`<p><span class="math" data-tex="${esc(t)}" data-display="1"></span></p>`);
      continue;
    }
    if (!trimmed) {
      flush();
      continue;
    }
    const h = trimmed.match(/^(#{1,6})\s+(.*?)\s*#*$/);
    if (h) {
      flush();
      out.push(h[1].length <= 2 ? `<h2>${inline(h[2])}</h2>` : `<h3>${inline(h[2])}</h3>`);
      continue;
    }
    if (/^([-*_])(\s*\1){2,}$/.test(trimmed)) {
      flush();
      out.push('<hr>');
      continue;
    }
    if (trimmed.startsWith('>')) {
      flush();
      const q: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) q.push(lines[i++].trim().replace(/^>\s?/, ''));
      i--;
      out.push(`<blockquote>${q.map(inline).join('<br>')}</blockquote>`);
      continue;
    }
    // Tabellen kennen Text-Dokumente nicht – Zeilen werden zu Aufzählungspunkten.
    if (/^\|.*\|$/.test(trimmed)) {
      flushPara();
      if (/^\|[\s:|-]+\|$/.test(trimmed)) continue;
      const cells = trimmed.slice(1, -1).split('|').map((c) => c.trim()).filter(Boolean);
      if (!stack.length) stack = [{ ordered: false, check: false, indent: 0, items: [] }];
      stack[0].items.push({ html: inline(cells.join(' – ')), check: false, children: null });
      continue;
    }
    const li = line.match(/^(\s*)([-*+•]|\d{1,3}[.)])\s+(\[[ xX]\]\s+)?(.*)$/);
    if (li) {
      flushPara();
      const indent = li[1].replace(/\t/g, '    ').length;
      const ordered = /\d/.test(li[2]);
      const check = !!li[3];
      const item: ListItem = { html: inline(li[4]), check, children: null };
      while (stack.length && indent < stack[stack.length - 1].indent) stack.pop();
      const top = stack[stack.length - 1];
      if (!top) stack.push({ ordered, check, indent, items: [item] });
      else if (indent > top.indent && top.items.length) {
        const parent = top.items[top.items.length - 1];
        parent.children = { ordered, check, indent, items: [item] };
        stack.push(parent.children);
      } else top.items.push(item);
      continue;
    }
    // Fortsetzungszeile eines Listenpunkts
    if (stack.length && /^\s{2,}\S/.test(line) && !para.length) {
      const top = stack[stack.length - 1];
      const last = top.items[top.items.length - 1];
      if (last) {
        last.html += `<br>${inline(trimmed)}`;
        continue;
      }
    }
    flushList();
    para.push(trimmed);
  }
  flush();
  return out.join('');
}

/** Titel aus der ersten Überschrift „# …“ holen und aus dem Text entfernen. */
export function splitTitle(md: string): { title: string; body: string } {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const first = lines.findIndex((l) => l.trim());
  const m = first >= 0 ? lines[first].trim().match(/^#\s+(.*?)\s*#*$/) : null;
  if (!m) return { title: '', body: md };
  return { title: m[1].replace(/[*_`$]/g, '').trim(), body: lines.slice(first + 1).join('\n') };
}
