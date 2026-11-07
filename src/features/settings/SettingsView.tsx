import { useEffect, useRef, useState } from 'react';
import { useLibrary } from '../../state/Library';
import { db } from '../../storage/db';
import { exportBackup, importBackup } from '../../storage/backup';
import { downloadBlob, formatSize } from '../../lib/files';
import { Icon } from '../../components/Icon';
import { Sheet } from '../../components/Sheet';
import { AccountCard } from '../account/AccountCard';
import { cloudEnabled, SERVER_LIMIT } from '../../cloud/supabase';
import { useAuth } from '../../cloud/auth';
import { serverUsage } from '../../cloud/remote';
import { cacheLimit, cacheSize } from '../../storage/blobs';

export function SettingsView() {
  const lib = useLibrary();
  const { reload } = lib;
  // Speicher-Übersicht: nur eigene Ordner/Dateien auf diesem Gerät.
  const folders = lib.folders.filter((f) => !f.shareId);
  const files = lib.files.filter((f) => !f.shareId);
  const [usage, setUsage] = useState<{ used: number; quota: number } | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [cache, setCache] = useState<{ size: number; limit: number } | null>(null);
  const [status, setStatus] = useState<{ kind: 'good' | 'critical' | 'info'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingImport, setPendingImport] = useState<File | null>(null);
  const importInput = useRef<HTMLInputElement>(null);

  const totalSize = files.reduce((s, f) => s + f.size, 0);

  useEffect(() => {
    navigator.storage?.estimate?.().then((e) => setUsage({ used: e.usage ?? 0, quota: e.quota ?? 0 })).catch(() => {});
    navigator.storage?.persisted?.().then(setPersisted).catch(() => {});
    Promise.all([cacheSize(), cacheLimit()])
      .then(([size, limit]) => setCache({ size, limit }))
      .catch(() => {});
  }, [files.length]);

  const doExport = async () => {
    setBusy(true);
    try {
      const blob = await exportBackup((msg) => setStatus({ kind: 'info', text: msg }));
      const date = new Date().toISOString().slice(0, 10);
      downloadBlob(blob, `Lernapp-Backup-${date}.zip`);
      setStatus({ kind: 'good', text: `Backup erstellt (${formatSize(blob.size)}).` });
    } catch (e) {
      console.error(e);
      setStatus({ kind: 'critical', text: 'Backup fehlgeschlagen – evtl. ist es zu groß für den Arbeitsspeicher dieses Geräts.' });
    } finally {
      setBusy(false);
    }
  };

  const doImport = async (replaceAll: boolean) => {
    const file = pendingImport;
    setPendingImport(null);
    if (!file) return;
    setBusy(true);
    setStatus({ kind: 'info', text: 'Backup wird eingelesen …' });
    try {
      const r = await importBackup(file, replaceAll);
      await reload();
      setStatus({ kind: 'good', text: `Wiederhergestellt: ${r.folders} Ordner, ${r.files} Dateien.` });
    } catch (e) {
      console.error(e);
      setStatus({ kind: 'critical', text: e instanceof Error ? e.message : 'Import fehlgeschlagen.' });
    } finally {
      setBusy(false);
    }
  };

  const wipe = async () => {
    if (!confirm('Wirklich ALLE Ordner und Dateien auf diesem Gerät löschen? Das kann nicht rückgängig gemacht werden. (Geteilte Ordner auf dem Server bleiben erhalten.)')) return;
    await db.clearAll();
    await reload();
    setStatus({ kind: 'good', text: 'Alle Daten wurden gelöscht.' });
  };

  const requestPersist = async () => {
    const ok = await navigator.storage?.persist?.().catch(() => false);
    setPersisted(!!ok);
  };

  return (
    <section className="view">
      <header className="view-header">
        <h1>Einstellungen</h1>
      </header>

      {cloudEnabled && (
        <>
          <h2 className="settings-group">Konto</h2>
          <p className="muted small">Gilt auf allen Geräten, auf denen du angemeldet bist. Ein Konto brauchst du nur, um Ordner mit anderen zu teilen.</p>
          <AccountCard />
          <ServerStorage />
        </>
      )}

      <h2 className="settings-group">Auf diesem Gerät</h2>
      <p className="muted small">Gilt nur für dieses Gerät – nicht für dein Konto.</p>

      <h3 className="section-title">Speicher</h3>
      <div className="card stack">
        <div className="tiles">
          <div className="tile">
            <span className="muted small">Ordner</span>
            <strong>{folders.length}</strong>
          </div>
          <div className="tile">
            <span className="muted small">Dateien</span>
            <strong>{files.length}</strong>
          </div>
          <div className="tile">
            <span className="muted small">Größe</span>
            <strong>{formatSize(totalSize)}</strong>
          </div>
        </div>
        {usage && usage.quota > 0 && (
          <div>
            <div className="meter wide">
              <div className="meter-fill" style={{ width: `${Math.min(100, (usage.used / usage.quota) * 100).toFixed(1)}%` }} />
            </div>
            <p className="muted small">
              {formatSize(usage.used)} von ca. {formatSize(usage.quota)} verfügbarem Browser-Speicher belegt
            </p>
          </div>
        )}
        <p className="muted small">
          „Meine Ordner“ werden nur auf diesem Gerät gespeichert (im Browser) – nutze das Backup, um sie auf ein anderes Gerät zu
          übertragen. Geteilte Ordner liegen auf dem Server; geöffnete Dateien daraus werden hier zwischengespeichert, damit du sie
          auch offline ansehen kannst – aber nur begrenzt: Wird es zu viel, werden die am längsten nicht geöffneten wieder
          entfernt (sie bleiben auf dem Server). „Meine Ordner“ sind davon nie betroffen.
        </p>
        {cache && cache.size > 0 && (
          <p className="muted small">
            Zwischengespeicherte geteilte Dateien: {formatSize(cache.size)} von höchstens {formatSize(cache.limit)}
          </p>
        )}
        {persisted === false && (
          <div className="notice warning">
            <span className="grow">Der Browser darf die Daten bei Speicherknappheit löschen.</span>
            <button className="link" onClick={requestPersist}>
              Dauerhaft speichern
            </button>
          </div>
        )}
        {persisted && <p className="muted small">✓ Daten sind als dauerhaft markiert.</p>}
      </div>

      <h3 className="section-title">Backup</h3>
      <div className="card stack">
        <p className="muted small">
          Das Backup ist eine ZIP-Datei mit all deinen Dateien in ihrer Ordnerstruktur. Damit kannst du alles auf einem
          anderen Gerät wiederherstellen. Geteilte Ordner sind nicht enthalten (die liegen auf dem Server).
        </p>
        <div className="input-row wrap">
          <button className="btn primary" onClick={doExport} disabled={busy || files.length + folders.length === 0}>
            <Icon name="download" size={18} /> Backup exportieren
          </button>
          <button className="btn ghost" onClick={() => importInput.current?.click()} disabled={busy}>
            <Icon name="upload" size={18} /> Backup importieren
          </button>
          <input
            ref={importInput}
            type="file"
            accept=".zip,application/zip"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) setPendingImport(f);
              e.target.value = '';
            }}
          />
        </div>
        {status && <p className={`notice ${status.kind}`}>{status.text}</p>}
      </div>

      <h3 className="section-title">Gefahrenzone</h3>
      <div className="card stack">
        <p className="muted small">Löscht „Meine Ordner“ und alles Zwischengespeicherte auf diesem Gerät. Dein Konto und geteilte Ordner bleiben bestehen.</p>
        <button className="btn ghost danger" onClick={wipe} disabled={busy}>
          <Icon name="trash" size={18} /> Alle Daten auf diesem Gerät löschen
        </button>
      </div>

      <p className="muted small center-text">Lernapp · Version 0.12</p>

      {pendingImport && (
        <Sheet title="Backup importieren" onClose={() => setPendingImport(null)}>
          <p className="muted">
            „{pendingImport.name}“ ({formatSize(pendingImport.size)})
          </p>
          <button className="card card-btn row-card" onClick={() => doImport(false)}>
            <Icon name="plus" />
            <div className="card-main">
              <strong>Hinzufügen</strong>
              <span className="muted small">Vorhandene Ordner bleiben, das Backup kommt zusätzlich dazu.</span>
            </div>
          </button>
          <button className="card card-btn row-card" onClick={() => doImport(true)}>
            <Icon name="trash" />
            <div className="card-main">
              <strong>Alles ersetzen</strong>
              <span className="muted small">Löscht zuerst alle Daten auf diesem Gerät und stellt dann das Backup her.</span>
            </div>
          </button>
        </Sheet>
      )}
    </section>
  );
}

/** Belegter Server-Speicher (kostenloser Tarif: ca. 1 GB für alle Konten zusammen). */
function ServerStorage() {
  const { user } = useAuth();
  const { online, files } = useLibrary();
  const [used, setUsed] = useState<number | null>(null);
  const sharedCount = files.filter((f) => f.shareId).length;

  useEffect(() => {
    if (!user || !online) return;
    let alive = true;
    serverUsage().then((n) => alive && setUsed(n));
    return () => {
      alive = false;
    };
  }, [user, online, sharedCount]);

  if (!user || used == null) return null;
  const pct = Math.min(100, (used / SERVER_LIMIT) * 100);
  const level = pct >= 95 ? 'critical' : pct >= 80 ? 'warning' : 'good';
  const free = Math.max(0, SERVER_LIMIT - used);

  return (
    <>
      <h3 className="section-title">Server-Speicher</h3>
      <div className="card stack">
        <div>
          <div className="meter wide">
            <div className={`meter-fill ${level === 'good' ? '' : level}`} style={{ width: `${pct.toFixed(1)}%` }} />
          </div>
          <p className="muted small">
            ca. {formatSize(used)} von {formatSize(SERVER_LIMIT)} belegt · noch ca. {formatSize(free)} frei
          </p>
        </div>
        {level === 'warning' && <p className="notice warning">Der Server wird langsam voll. Große Uploads klappen evtl. bald nicht mehr.</p>}
        {level === 'critical' && (
          <p className="notice critical">Der Server ist fast voll. Lösche nicht mehr gebrauchte Dateien in geteilten Ordnern, damit wieder Platz ist.</p>
        )}
        <p className="muted small">
          Gilt für alle Konten zusammen (geteilte Ordner, „Meine Ordner auf allen Geräten“ und Profilbilder). Der Wert ist ein
          ungefährer Richtwert und kann etwas nachhinken.
        </p>
      </div>
    </>
  );
}
