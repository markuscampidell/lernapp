import { useState } from 'react';
import type { Handover } from '../../cloud/remote';
import { Sheet } from '../../components/Sheet';
import { formatSize } from '../../lib/files';
import { useLibrary } from '../../state/Library';

const DAY = 24 * 60 * 60 * 1000;
const plural = (n: number, one: string, many: string) => `${n.toLocaleString('de-DE')} ${n === 1 ? one : many}`;

/** Hinweis oben: Jemand hat das Konto gelöscht und mir die geteilten Ordner übergeben. */
export function HandoverBanner() {
  const { handovers } = useLibrary();
  if (!handovers.length) return null;
  return (
    <>
      {handovers.map((h) => (
        <HandoverNotice key={h.id} h={h} />
      ))}
    </>
  );
}

function HandoverNotice({ h }: { h: Handover }) {
  const { handoverStats, declineHandover, online } = useLibrary();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const stats = handoverStats(h);
  const days = Math.max(0, Math.ceil((Date.parse(h.expiresAt) - Date.now()) / DAY));

  const decline = async () => {
    if (!confirm(`Bist du sicher? ${plural(stats.folders, 'Ordner', 'Ordner')} mit ${plural(stats.files, 'Datei', 'Dateien')} werden endgültig gelöscht – für alle.`)) return;
    setBusy(true);
    setErr(null);
    try {
      await declineHandover(h.id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Das hat nicht geklappt.');
      setBusy(false);
    }
  };

  return (
    <div className="card stack handover" role="region" aria-label="Übergebene Ordner">
      <p>
        <strong>{h.fromName}</strong> hat das Konto gelöscht und dir {plural(stats.folders, 'Ordner', 'Ordner')} mit {plural(stats.files, 'Datei', 'Dateien')} (
        {formatSize(stats.bytes)}) übergeben{stats.names.length ? `: ${stats.names.join(', ')}` : ''}.
      </p>
      <p className="muted small">
        {days > 0 ? `Noch ${plural(days, 'Tag', 'Tage')} – danach wird alles gelöscht.` : 'Läuft heute ab – danach wird alles gelöscht.'}
      </p>
      <div className="input-row wrap">
        <button className="btn ghost danger" onClick={decline} disabled={busy || !online}>
          Ablehnen
        </button>
        <button className="btn primary grow" onClick={() => setOpen(true)} disabled={busy || !online}>
          Übernehmen
        </button>
      </div>
      {!online && <p className="muted small">Keine Verbindung zum Server.</p>}
      {err && <p className="notice critical">{err}</p>}
      {open && <ClaimSheet h={h} onClose={() => setOpen(false)} />}
    </div>
  );
}

function ClaimSheet({ h, onClose }: { h: Handover; onClose: () => void }) {
  const { handoverStats, claimHandover } = useLibrary();
  const stats = handoverStats(h);
  const [mode, setMode] = useState<'shared' | 'local'>(stats.people.length ? 'shared' : 'local');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setErr(null);
    setBusy('Bitte warten …');
    try {
      await claimHandover(h.id, mode, setBusy);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Das hat nicht geklappt.');
      setBusy(null);
    }
  };

  return (
    <Sheet
      title="Ordner übernehmen"
      onClose={() => !busy && onClose()}
      footer={
        <div className="input-row">
          <button className="btn ghost" onClick={onClose} disabled={!!busy}>
            Abbrechen
          </button>
          <button className="btn primary grow" onClick={submit} disabled={!!busy}>
            {busy ?? 'Übernehmen'}
          </button>
        </div>
      }
    >
      <div className="stack">
        <button type="button" className={`choice${mode === 'shared' ? ' selected' : ''}`} onClick={() => setMode('shared')} aria-pressed={mode === 'shared'}>
          <strong>Weiter teilen – du wirst Besitzer/in</strong>
          <span className="muted small">
            {stats.people.length
              ? `Bleibt ein geteilter Ordner. Weiterhin dabei: ${stats.people.join(', ')}. Du kannst Personen hinzufügen, entfernen oder das Teilen beenden.`
              : 'Bleibt ein geteilter Ordner (im Moment ohne weitere Personen). Du kannst später Personen hinzufügen.'}
          </span>
        </button>
        <button type="button" className={`choice${mode === 'local' ? ' selected' : ''}`} onClick={() => setMode('local')} aria-pressed={mode === 'local'}>
          <strong>In „Meine Ordner“ auf dieses Gerät</strong>
          <span className="muted small">
            Alles wird heruntergeladen ({formatSize(stats.bytes)}) und nur auf diesem Gerät gespeichert, dann vom Server gelöscht.
            {stats.people.length ? ` ${stats.people.join(', ')} ${stats.people.length === 1 ? 'sieht' : 'sehen'} die Ordner danach nicht mehr.` : ''}
          </span>
        </button>
        {err && <p className="notice critical">{err}</p>}
      </div>
    </Sheet>
  );
}
