import { unzip, strFromU8, type Unzipped } from 'fflate';

/**
 * Holt den Text aus Office-Dateien (Word, PowerPoint, Excel, OpenDocument), die Gemini nicht direkt lesen kann.
 * Gibt null zurück, wenn das Format nicht unterstützt wird oder nichts gefunden wurde.
 */
export async function extractOfficeText(blob: Blob, ext: string): Promise<string | null> {
  const e = ext.toLowerCase();
  if (!['docx', 'pptx', 'xlsx', 'odt', 'odp', 'ods'].includes(e)) return null;
  let files: Unzipped;
  try {
    const buf = new Uint8Array(await blob.arrayBuffer());
    files = await new Promise<Unzipped>((res, rej) => unzip(buf, (err, out) => (err ? rej(err) : res(out))));
  } catch {
    return null;
  }
  const xml = (name: string) => (files[name] ? new DOMParser().parseFromString(strFromU8(files[name]), 'application/xml') : null);
  const byTag = (n: Document | Element, tag: string) => Array.from(n.getElementsByTagName(tag));
  let out = '';

  if (e === 'docx') {
    const doc = xml('word/document.xml');
    if (!doc) return null;
    out = byTag(doc, 'w:p')
      .map((p) => byTag(p, 'w:t').map((t) => t.textContent).join(''))
      .join('\n');
  } else if (e === 'pptx') {
    const slides = Object.keys(files)
      .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
      .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
    out = slides
      .map((name, i) => {
        const doc = xml(name)!;
        const paras = byTag(doc, 'a:p')
          .map((p) => byTag(p, 'a:t').map((t) => t.textContent).join(''))
          .filter((s) => s.trim());
        const notesName = name.replace('slides/slide', 'notesSlides/notesSlide');
        const notes = xml(notesName);
        const noteText = notes ? byTag(notes, 'a:t').map((t) => t.textContent).join(' ').trim() : '';
        return `--- Folie ${i + 1} ---\n${paras.join('\n')}${noteText ? `\n[Notizen: ${noteText}]` : ''}`;
      })
      .join('\n\n');
  } else if (e === 'xlsx') {
    const ssDoc = xml('xl/sharedStrings.xml');
    const shared = ssDoc ? byTag(ssDoc, 'si').map((si) => byTag(si, 't').map((t) => t.textContent).join('')) : [];
    const sheets = Object.keys(files)
      .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
      .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
    out = sheets
      .map((name, i) => {
        const doc = xml(name)!;
        const rows = byTag(doc, 'row').map((row) =>
          byTag(row, 'c')
            .map((c) => {
              const v = c.getElementsByTagName('v')[0]?.textContent ?? c.getElementsByTagName('t')[0]?.textContent ?? '';
              return c.getAttribute('t') === 's' ? shared[Number(v)] ?? '' : v;
            })
            .join('\t'),
        );
        return `--- Tabellenblatt ${i + 1} ---\n${rows.join('\n')}`;
      })
      .join('\n\n');
  } else {
    // OpenDocument: Absätze/Überschriften aus content.xml
    const doc = xml('content.xml');
    if (!doc) return null;
    out = [...byTag(doc, 'text:h'), ...byTag(doc, 'text:p')].length
      ? Array.from(doc.querySelectorAll('*'))
          .filter((n) => n.tagName === 'text:p' || n.tagName === 'text:h')
          .map((n) => n.textContent)
          .join('\n')
      : '';
  }
  out = out.replace(/\n{3,}/g, '\n\n').trim();
  return out || null;
}
