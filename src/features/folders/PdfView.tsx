import { useEffect, useRef, useState } from 'react';

/** Zeigt ein PDF Seite für Seite (pdf.js – funktioniert auch auf Android, wo Browser PDFs nicht einbetten). */
export function PdfView({ blob }: { blob: Blob }) {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<{ pages: number; error?: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    let doc: { destroy: () => Promise<void> } | null = null;
    (async () => {
      try {
        const pdfjs = await import('pdfjs-dist');
        const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
        const pdf = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
        doc = pdf;
        if (cancelled) return;
        setState({ pages: pdf.numPages });
        const el = host.current!;
        const width = Math.min(el.clientWidth || 600, 1100);
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        for (let n = 1; n <= pdf.numPages && !cancelled; n++) {
          const page = await pdf.getPage(n);
          const base = page.getViewport({ scale: 1 });
          const vp = page.getViewport({ scale: (width / base.width) * ratio });
          const canvas = document.createElement('canvas');
          canvas.width = vp.width;
          canvas.height = vp.height;
          canvas.className = 'pdf-page';
          canvas.setAttribute('aria-label', `Seite ${n}`);
          el.appendChild(canvas);
          await page.render({ canvasContext: canvas.getContext('2d')!, viewport: vp }).promise;
        }
      } catch (e) {
        console.error(e);
        if (!cancelled) setState({ pages: 0, error: 'Dieses PDF kann hier nicht angezeigt werden. Öffne es mit einer anderen App.' });
      }
    })();
    return () => {
      cancelled = true;
      doc?.destroy().catch(() => {});
      if (host.current) host.current.innerHTML = '';
    };
  }, [blob]);

  return (
    <div className="pdf-view">
      {state?.error ? <p className="notice">{state.error}</p> : !state && <p className="muted">PDF wird geladen …</p>}
      {state && !state.error && <p className="muted small">{state.pages} Seite{state.pages === 1 ? '' : 'n'}</p>}
      <div ref={host} className="pdf-pages" />
    </div>
  );
}
