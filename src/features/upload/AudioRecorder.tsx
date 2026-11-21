import { useEffect, useRef, useState } from 'react';
import { Sheet } from '../../components/Sheet';
import { Icon } from '../../components/Icon';

/** Mögliche Formate, das erste, das der Browser kann, wird genommen (Safari: mp4, sonst webm/ogg). */
const TYPES: [string, string][] = [
  ['audio/webm;codecs=opus', 'weba'],
  ['audio/webm', 'weba'],
  ['audio/mp4', 'm4a'],
  ['audio/ogg;codecs=opus', 'ogg'],
];

const pad = (n: number) => String(n).padStart(2, '0');
const clock = (s: number) => `${Math.floor(s / 60)}:${pad(Math.floor(s % 60))}`;

/** Audio mit dem Mikrofon aufnehmen, anhören und als Datei übernehmen. */
export function AudioRecorder({ onDone, onClose }: { onDone: (file: File) => void; onClose: () => void }) {
  const [state, setState] = useState<'idle' | 'recording' | 'done'>('idle');
  const [secs, setSecs] = useState(0);
  const [result, setResult] = useState<{ file: File; url: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);

  const release = () => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  };

  // Beim Schließen: Mikrofon freigeben und Vorschau-URL aufräumen.
  useEffect(
    () => () => {
      if (rec.current && rec.current.state !== 'inactive') {
        rec.current.ondataavailable = null;
        rec.current.onstop = null;
        rec.current.stop();
      }
      release();
    },
    [],
  );
  useEffect(() => () => (result ? URL.revokeObjectURL(result.url) : undefined), [result]);

  useEffect(() => {
    if (state !== 'recording') return;
    const t0 = Date.now();
    const id = window.setInterval(() => setSecs((Date.now() - t0) / 1000), 250);
    return () => window.clearInterval(id);
  }, [state]);

  const start = async () => {
    setErr(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setErr('Dieser Browser kann kein Audio aufnehmen.');
      return;
    }
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setErr('Kein Zugriff aufs Mikrofon. Erlaube es in den Einstellungen des Browsers bzw. Geräts.');
      return;
    }
    const [mime, ext] = TYPES.find(([t]) => MediaRecorder.isTypeSupported(t)) ?? ['', 'weba'];
    const r = new MediaRecorder(stream.current, mime ? { mimeType: mime } : undefined);
    const chunks: Blob[] = [];
    r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    r.onstop = () => {
      release();
      const type = (r.mimeType || mime || 'audio/webm').split(';')[0];
      const d = new Date();
      const name = `Aufnahme ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}-${pad(d.getMinutes())}.${type === 'audio/mp4' ? 'm4a' : ext}`;
      const file = new File(chunks, name, { type });
      setResult({ file, url: URL.createObjectURL(file) });
      setState('done');
    };
    rec.current = r;
    r.start(1000);
    setSecs(0);
    setState('recording');
  };

  const stop = () => rec.current?.state === 'recording' && rec.current.stop();

  const again = () => {
    setResult(null);
    setState('idle');
    void start();
  };

  const close = () => {
    if (state === 'recording' && !confirm('Aufnahme verwerfen?')) return;
    onClose();
  };

  return (
    <Sheet
      title="Audio aufnehmen"
      onClose={close}
      footer={
        state === 'done' && result ? (
          <>
            <button className="btn ghost" onClick={again}>
              <Icon name="mic" size={18} /> Neu
            </button>
            <button className="btn primary grow" onClick={() => onDone(result.file)}>
              Weiter
            </button>
          </>
        ) : undefined
      }
    >
      <div className="recorder">
        {state === 'done' && result ? (
          <audio className="recorder-audio" src={result.url} controls />
        ) : (
          <>
            <span className={`recorder-time${state === 'recording' ? ' on' : ''}`}>{clock(secs)}</span>
            {state === 'recording' ? (
              <button className="recorder-btn stop" onClick={stop} aria-label="Aufnahme beenden" title="Beenden">
                <Icon name="stop" size={30} />
              </button>
            ) : (
              <button className="recorder-btn" onClick={start} aria-label="Aufnahme starten" title="Aufnehmen">
                <Icon name="mic" size={30} />
              </button>
            )}
          </>
        )}
        {err && <p className="notice critical">{err}</p>}
      </div>
    </Sheet>
  );
}
