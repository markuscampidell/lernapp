import { useEffect, useMemo, useRef, useState } from 'react';
import type { FileItem } from '../../domain/types';
import { SHARED_ROOT } from '../../domain/types';
import { childFolders, filesIn, pathOf, scopeOf, subtreeIds } from '../../domain/tree';
import { useLibrary } from '../../state/Library';
import { Sheet } from '../../components/Sheet';
import { Icon } from '../../components/Icon';
import { TextLine } from '../../components/TextLine';
import { FileThumb, FolderThumb } from '../../components/Thumbs';
import { EmptyState } from '../../components/EmptyState';
import { downloadBlob, fullName } from '../../lib/files';
import { CHART_TYPES } from '../charts/chart';
import { prepareMaterial, routeGuess, type Material } from './materials';
import { buildPrompt, DEFAULT_SETTINGS, kindInfo, KINDS, parseAnswer, type AiKind, type AiResult, type AiSettings, type Parsed } from './recipes';

// Eingaben überleben das Wechseln zur KI-App (auf Handys wird die App dabei manchmal neu geladen).
// Ein unfertiger Entwurf gilt nur ein paar Stunden; nach „Im Editor öffnen“ wird er geleert.
// Einstellungen wie Art, Niveau, Sprache und Anzahl bleiben dagegen als Vorgabe für das nächste Mal.
const DRAFT_KEY = 'lernapp-ai-draft';
const DRAFT_TTL = 2 * 60 * 60 * 1000;
interface Draft {
  settings: AiSettings;
  ids: string[];
  answer: string;
  savedAt?: number;
}
/** Nur die Vorgaben behalten – Thema, Wünsche, Materialien und Antwort leeren. */
const keepPreferences = (s: AiSettings): AiSettings => ({ ...s, topic: '', extra: '' });
function loadDraft(): Draft | null {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null') as Draft | null;
    if (!d || typeof d !== 'object') return null;
    const settings = { ...DEFAULT_SETTINGS, ...d.settings };
    if (!d.savedAt || Date.now() - d.savedAt > DRAFT_TTL) return { settings: keepPreferences(settings), ids: [], answer: '' };
    return { settings, ids: Array.isArray(d.ids) ? d.ids : [], answer: typeof d.answer === 'string' ? d.answer : '' };
  } catch {
    return null;
  }
}
function saveDraft(d: Draft) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...d, savedAt: Date.now() }));
  } catch {
    /* privater Modus o. Ä. – dann eben ohne Entwurf */
  }
}

const LONG_PROMPT = 120_000;
const HUGE_PROMPT = 400_000;

function Seg<T extends string | number>({ value, options, onChange }: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="segmented">
      {options.map((o) => (
        <button key={String(o.id)} type="button" className={o.id === value ? 'on' : ''} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="ai-step">
      <div className="ai-step-head">
        <span className="ai-step-num">{n}</span>
        <h3>{title}</h3>
      </div>
      {children}
    </section>
  );
}

/** „Mit KI erstellen“: Prompt bauen, Materialien mitgeben, Antwort einlesen. */
export function AiSheet({ folderId, onResult, onClose }: { folderId: string; onResult: (r: AiResult) => void; onClose: () => void }) {
  const { files } = useLibrary();
  const initial = useRef(loadDraft()).current;
  const [restored, setRestored] = useState(!!initial && (initial.ids.length > 0 || !!initial.answer || !!initial.settings.topic));
  const [s, setS] = useState<AiSettings>(initial?.settings ?? DEFAULT_SETTINGS);
  const [ids, setIds] = useState<string[]>(initial?.ids ?? []);
  const [answer, setAnswer] = useState(initial?.answer ?? '');
  const [mats, setMats] = useState<Map<string, Material>>(new Map());
  const [picking, setPicking] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);

  const set = (patch: Partial<AiSettings>) => setS((old) => ({ ...old, ...patch }));
  const info = kindInfo(s.kind);

  const finished = useRef(false);
  useEffect(() => {
    if (!finished.current) saveDraft({ settings: s, ids, answer });
  }, [s, ids, answer]);

  const openResult = (r: AiResult) => {
    // Fertig: Beim nächsten Mal frisch anfangen, aber mit denselben Einstellungen.
    finished.current = true;
    saveDraft({ settings: keepPreferences(s), ids: [], answer: '' });
    onResult(r);
  };

  // Ausgewählte Dateien laden und auslesen (jede nur einmal).
  const selected = useMemo(() => ids.map((id) => files.find((f) => f.id === id)).filter((f): f is FileItem => !!f), [ids, files]);
  useEffect(() => {
    let alive = true;
    for (const f of selected) {
      if (mats.has(f.id)) continue;
      setMats((m) => new Map(m).set(f.id, { file: f, status: 'loading', route: routeGuess(f).route }));
      prepareMaterial(f)
        .catch((): Material => ({ file: f, status: 'error', route: 'skip', note: 'Konnte nicht gelesen werden' }))
        .then((m) => alive && setMats((old) => new Map(old).set(f.id, m)));
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  const list = useMemo(() => selected.map((f) => mats.get(f.id)).filter((m): m is Material => !!m), [selected, mats]);
  const loading = list.some((m) => m.status === 'loading') || list.length < selected.length;
  const asText = list.filter((m) => m.status === 'ready' && m.route === 'text');
  const asFiles = list.filter((m) => m.status === 'ready' && m.route === 'file' && m.blob);
  const prompt = useMemo(() => buildPrompt(s, list), [s, list]);

  const parsed = useMemo((): { ok: Parsed } | { err: string } | null => {
    if (!answer.trim()) return null;
    try {
      return { ok: parseAnswer(answer, s) };
    } catch (e) {
      return { err: e instanceof Error ? e.message : 'Die Antwort konnte nicht gelesen werden.' };
    }
  }, [answer, s]);

  const flash = (msg: string) => {
    setCopied(msg);
    setActionErr(null);
    window.setTimeout(() => setCopied((c) => (c === msg ? null : c)), 4000);
  };

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      flash('Prompt kopiert – jetzt in der KI einfügen.');
    } catch {
      // Ältere Browser: über ein unsichtbares Textfeld kopieren
      const ta = document.createElement('textarea');
      ta.value = prompt;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      if (ok) flash('Prompt kopiert – jetzt in der KI einfügen.');
      else {
        setShowPrompt(true);
        setActionErr('Kopieren hat nicht geklappt. Öffne unten „Prompt ansehen“, markiere alles und kopiere es selbst.');
      }
    }
  };

  const fileList = asFiles.map((m) => m.blob!) as File[];
  const canShareFiles = typeof navigator.canShare === 'function' && fileList.length > 0 && (() => {
    try {
      return navigator.canShare({ files: fileList });
    } catch {
      return false;
    }
  })();
  const shareFiles = async () => {
    try {
      await navigator.share({ files: fileList, title: 'Materialien für die KI' });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      setActionErr('Teilen hat nicht geklappt – lade die Dateien stattdessen herunter.');
    }
  };
  const downloadFiles = async () => {
    for (const f of fileList) {
      downloadBlob(f, f.name);
      await new Promise((r) => window.setTimeout(r, 450));
    }
    flash(fileList.length === 1 ? 'Datei heruntergeladen.' : `${fileList.length} Dateien heruntergeladen.`);
  };
  const canSharePrompt = typeof navigator.share === 'function' && prompt.length < 60_000;
  const sharePrompt = async () => {
    try {
      await navigator.share({ text: prompt });
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) setActionErr('Teilen hat nicht geklappt – nimm „Prompt kopieren“.');
    }
  };

  const canReadClipboard = typeof navigator.clipboard?.readText === 'function';
  const pasteAnswer = async () => {
    try {
      const t = await navigator.clipboard.readText();
      if (!t.trim()) setActionErr('Die Zwischenablage ist leer. Kopiere zuerst die Antwort der KI.');
      else {
        setAnswer(t);
        setActionErr(null);
      }
    } catch {
      setActionErr('Die App darf die Zwischenablage nicht lesen. Tippe lange ins Feld unten und wähle „Einfügen“.');
    }
  };

  // Andere Art gewählt: Alles Eingegebene gehört zur alten Art und wird geleert.
  const [cleared, setCleared] = useState(false);
  const switchKind = (kind: AiKind) => {
    const had = !!(s.topic.trim() || s.extra.trim() || ids.length || answer.trim());
    set({ kind, count: kindInfo(kind).count?.def ?? s.count, topic: '', extra: '' });
    setIds([]);
    setAnswer('');
    setRestored(false);
    setCleared(had);
  };

  const reset = () => {
    setS(DEFAULT_SETTINGS);
    setIds([]);
    setAnswer('');
    setRestored(false);
  };

  const ok = parsed && 'ok' in parsed ? parsed.ok : null;
  let stepNo = 0;

  return (
    <Sheet
      title="Mit KI erstellen"
      onClose={onClose}
      footer={
        <button className="btn primary grow" disabled={!ok} onClick={() => ok && openResult(ok.result)}>
          {ok ? `${info.label} im Editor öffnen` : 'Erst die Antwort der KI einfügen'}
        </button>
      }
    >
      <div className="ai-sheet stack">
        <div className="notice info ai-intro">
          <Icon name="sparkle" size={18} />
          <span className="grow">
            Die App schreibt einen genauen Auftrag („Prompt“) für eine KI wie ChatGPT, Claude oder Gemini. Du gibst ihn dort ein, kopierst die Antwort
            zurück – und die App macht daraus fertige Karteikarten, ein Quiz usw. Du brauchst nur Zugang zu irgendeiner KI, kein extra Konto.
          </span>
        </div>
        {restored && (
          <p className="muted small">
            Deine letzten Eingaben wurden wiederhergestellt.{' '}
            <button className="link" onClick={reset}>
              Neu beginnen
            </button>
          </p>
        )}

        <Step n={++stepNo} title="Was soll erstellt werden?">
          {cleared && (
            <p className="notice info">
              <span className="grow">Neue Art gewählt – Thema, Wünsche, Materialien und die eingefügte Antwort wurden geleert.</span>
              <button className="link" onClick={() => setCleared(false)}>
                OK
              </button>
            </p>
          )}
          <div className="ai-kinds">
            {KINDS.map((k) => (
              <button
                key={k.id}
                type="button"
                className={`ai-kind${k.id === s.kind ? ' on' : ''}`}
                aria-pressed={k.id === s.kind}
                onClick={() => k.id !== s.kind && switchKind(k.id)}
              >
                <span className={`thumb add-icon add-${k.id}`}>
                  <Icon name={k.icon} size={20} />
                </span>
                <strong>{k.label}</strong>
                <span className="muted small">{k.text}</span>
              </button>
            ))}
          </div>
        </Step>

        <Step n={++stepNo} title="Worum geht’s?">
          <div className="field">
            <div className="field-label">
              <span>Thema</span>
            </div>
            <TextLine value={s.topic} onChange={(v) => set({ topic: v })} placeholder="z. B. Ableitungsregeln, Kapitel 3, Zellbiologie …" maxLength={300} />
            <p className="muted small">
              {asText.length + asFiles.length > 0
                ? 'Optional: Worauf soll sich die KI in deinen Materialien konzentrieren? Leer lassen = alles.'
                : 'Ohne Materialien schreibt die KI aus ihrem eigenen Wissen zu diesem Thema.'}
            </p>
          </div>

          {info.count && (
            <div className="field">
              <div className="field-label">
                <span>{info.count.label}</span>
                <span className="muted small">
                  {info.count.min}–{info.count.max}
                </span>
              </div>
              <input
                type="number"
                inputMode="numeric"
                min={info.count.min}
                max={info.count.max}
                value={s.count}
                onChange={(e) => set({ count: Number(e.target.value) || 0 })}
                onBlur={() => set({ count: Math.max(info.count!.min, Math.min(info.count!.max, Math.round(s.count) || info.count!.def)) })}
              />
            </div>
          )}

          {s.kind === 'cards' && (
            <div className="field">
              <div className="field-label">
                <span>Art der Karten</span>
              </div>
              <Seg
                value={s.cardStyle}
                onChange={(v) => set({ cardStyle: v })}
                options={[
                  { id: 'mixed', label: 'Gemischt' },
                  { id: 'term', label: 'Begriff → Erklärung' },
                  { id: 'question', label: 'Frage → Antwort' },
                ]}
              />
            </div>
          )}

          {s.kind === 'quiz' && (
            <>
              <div className="field">
                <div className="field-label">
                  <span>Antworten pro Frage</span>
                </div>
                <Seg value={s.answers} onChange={(v) => set({ answers: v })} options={[3, 4, 5].map((n) => ({ id: n, label: String(n) }))} />
              </div>
              <label className="input-row">
                <span className="grow">
                  Mehrere richtige Antworten erlaubt
                  <span className="muted small block">Sonst ist immer genau eine Antwort richtig.</span>
                </span>
                <input type="checkbox" className="switch" checked={s.multi} onChange={(e) => set({ multi: e.target.checked })} />
              </label>
            </>
          )}

          {s.kind === 'doc' && (
            <>
              <div className="field">
                <div className="field-label">
                  <span>Art des Dokuments</span>
                </div>
                <Seg
                  value={s.docStyle}
                  onChange={(v) => set({ docStyle: v })}
                  options={[
                    { id: 'summary', label: 'Zusammenfassung' },
                    { id: 'sheet', label: 'Lernzettel' },
                    { id: 'explain', label: 'Erklärung' },
                    { id: 'outline', label: 'Checkliste' },
                  ]}
                />
              </div>
              <div className="field">
                <div className="field-label">
                  <span>Länge</span>
                </div>
                <Seg
                  value={s.length}
                  onChange={(v) => set({ length: v })}
                  options={[
                    { id: 'short', label: 'Kurz' },
                    { id: 'medium', label: 'Mittel' },
                    { id: 'long', label: 'Ausführlich' },
                  ]}
                />
              </div>
            </>
          )}

          {s.kind === 'note' && (
            <>
              <div className="field">
                <div className="field-label">
                  <span>Form</span>
                </div>
                <Seg
                  value={s.noteStyle}
                  onChange={(v) => set({ noteStyle: v })}
                  options={[
                    { id: 'bullets', label: 'Stichpunkte' },
                    { id: 'summary', label: 'Fließtext' },
                  ]}
                />
              </div>
              <div className="field">
                <div className="field-label">
                  <span>Länge</span>
                </div>
                <Seg
                  value={s.length}
                  onChange={(v) => set({ length: v })}
                  options={[
                    { id: 'short', label: 'Kurz' },
                    { id: 'medium', label: 'Mittel' },
                    { id: 'long', label: 'Länger' },
                  ]}
                />
              </div>
            </>
          )}

          {s.kind === 'chart' && (
            <div className="field">
              <div className="field-label">
                <span>Diagrammart</span>
              </div>
              <Seg value={s.chartType} onChange={(v) => set({ chartType: v })} options={[{ id: 'auto' as const, label: 'Automatisch' }, ...CHART_TYPES]} />
            </div>
          )}

          {s.kind === 'wheel' && (
            <label className="input-row">
              <span className="grow">
                Gezogene Einträge herausnehmen
                <span className="muted small block">Jeder Eintrag kommt erst wieder dran, wenn du das Rad zurücksetzt.</span>
              </span>
              <input type="checkbox" className="switch" checked={s.removePicked} onChange={(e) => set({ removePicked: e.target.checked })} />
            </label>
          )}

          {s.kind !== 'chart' && s.kind !== 'wheel' && (
            <div className="field">
              <div className="field-label">
                <span>Niveau</span>
              </div>
              <Seg
                value={s.level}
                onChange={(v) => set({ level: v })}
                options={[
                  { id: 'basic', label: 'Grundlagen' },
                  { id: 'medium', label: 'Mittel' },
                  { id: 'exam', label: 'Prüfung' },
                ]}
              />
            </div>
          )}

          <div className="field">
            <div className="field-label">
              <span>Sprache</span>
            </div>
            <Seg
              value={s.language}
              onChange={(v) => set({ language: v })}
              options={[
                { id: 'material', label: 'Wie die Materialien' },
                { id: 'de', label: 'Deutsch' },
                { id: 'en', label: 'Englisch' },
              ]}
            />
          </div>

          <div className="field">
            <div className="field-label">
              <span>Zusätzliche Wünsche (optional)</span>
            </div>
            <textarea
              rows={2}
              value={s.extra}
              onChange={(e) => set({ extra: e.target.value })}
              maxLength={2000}
              placeholder="z. B. „nur Kapitel 3“, „besonders die Beweise“, „mit Beispielen aus der Physik“"
            />
          </div>
        </Step>

        <Step n={++stepNo} title="Materialien (optional)">
          <p className="muted small">
            Wähle Dateien aus deinen Ordnern, aus denen die KI arbeiten soll – z. B. Skript, Mitschrift, Folien oder Fotos von deinen Notizen. Ohne
            Materialien nutzt die KI ihr eigenes Wissen. Die App sortiert automatisch:
          </p>
          <ul className="ai-legend muted small">
            <li>
              <span className="chip ai-route text">Im Prompt</span> Text-Dokumente, Notizen, Karteikarten, PDFs mit Text, Word und PowerPoint: Der Text
              wird ausgelesen und steht direkt im Prompt.
            </li>
            <li>
              <span className="chip ai-route file">Direkt an die KI</span> Fotos, Bilder und eingescannte PDFs kann die App nicht lesen – die gibst du der
              KI selbst mit (Schritt {stepNo + 1}). KIs wie ChatGPT können Bilder und Handschrift lesen.
            </li>
          </ul>
          <button className="btn ghost" onClick={() => setPicking(true)}>
            <Icon name="folder" size={18} /> {ids.length ? 'Auswahl ändern' : 'Materialien auswählen'}
          </button>
          {selected.length > 0 && (
            <ul className="list ai-mats">
              {selected.map((f) => {
                const m = mats.get(f.id);
                const route = m?.status === 'loading' || !m ? 'loading' : m.status === 'error' ? 'skip' : m.route;
                return (
                  <li key={f.id} className="card row-card">
                    <FileThumb file={f} />
                    <div className="card-main">
                      <strong className="ellipsis">{fullName(f)}</strong>
                      <span className="small">
                        <span className={`chip ai-route ${route}`}>
                          {route === 'loading' ? 'Wird gelesen …' : route === 'text' ? 'Im Prompt' : route === 'file' ? 'Direkt an die KI' : 'Wird nicht verwendet'}
                        </span>{' '}
                        {m?.note && <span className="muted">{m.note}</span>}
                      </span>
                    </div>
                    <button className="icon-btn" aria-label={`„${fullName(f)}“ entfernen`} onClick={() => setIds((x) => x.filter((id) => id !== f.id))}>
                      <Icon name="close" size={18} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {ids.length > selected.length && <p className="muted small">{ids.length - selected.length} ausgewählte Dateien gibt es nicht mehr.</p>}
        </Step>

        <Step n={++stepNo} title="Prompt an die KI geben">
          <ol className="ai-howto">
            <li>Tippe auf „Prompt kopieren“.</li>
            <li>Öffne deine KI (z. B. ChatGPT, Claude oder Gemini) und starte ein neues Gespräch.</li>
            {asFiles.length > 0 && (
              <li>
                Hänge {asFiles.length === 1 ? 'die Datei' : `die ${asFiles.length} Dateien`} an, die „Direkt an die KI“ gehen:{' '}
                {canShareFiles
                  ? 'Tippe auf „Dateien teilen“ und wähle deine KI-App – oder lade sie herunter und hänge sie in der KI über die Büroklammer bzw. das „+“ an.'
                  : 'Tippe auf „Dateien herunterladen“ und hänge sie in der KI über die Büroklammer bzw. das „+“ an.'}
              </li>
            )}
            <li>Füge den Prompt ins Eingabefeld der KI ein (lange tippen → „Einfügen“ bzw. Strg+V) und schick ihn ab.</li>
          </ol>
          {loading && <p className="notice info">Materialien werden noch gelesen … warte kurz, bevor du den Prompt kopierst.</p>}
          {prompt.length > HUGE_PROMPT ? (
            <p className="notice critical">
              Der Prompt ist mit ca. {prompt.length.toLocaleString('de')} Zeichen sehr lang – das schafft kaum eine KI auf einmal. Wähle weniger Dateien
              oder nur einzelne Kapitel.
            </p>
          ) : prompt.length > LONG_PROMPT ? (
            <p className="notice warning">
              Langer Prompt (ca. {prompt.length.toLocaleString('de')} Zeichen). Kostenlose KI-Versionen schaffen das evtl. nicht – dann wähle weniger Dateien.
            </p>
          ) : (
            <p className="muted small">
              Prompt: ca. {prompt.length.toLocaleString('de')} Zeichen
              {asText.length > 0 && ` · ${asText.length} ${asText.length === 1 ? 'Datei' : 'Dateien'} als Text`}
              {asFiles.length > 0 && ` · ${asFiles.length} ${asFiles.length === 1 ? 'Datei' : 'Dateien'} zum Anhängen`}
            </p>
          )}
          <div className="input-row wrap">
            <button className="btn primary" onClick={copyPrompt} disabled={loading}>
              <Icon name="copy" size={18} /> Prompt kopieren
            </button>
            {asFiles.length > 0 && canShareFiles && (
              <button className="btn ghost" onClick={shareFiles}>
                <Icon name="share" size={18} /> Dateien teilen
              </button>
            )}
            {asFiles.length > 0 && (
              <button className="btn ghost" onClick={downloadFiles}>
                <Icon name="download" size={18} /> Dateien herunterladen
              </button>
            )}
            {canSharePrompt && !loading && (
              <button className="btn ghost" onClick={sharePrompt}>
                <Icon name="share" size={18} /> Prompt teilen
              </button>
            )}
          </div>
          {copied && <p className="notice good">{copied}</p>}
          {actionErr && <p className="notice critical">{actionErr}</p>}
          <button className="link small" onClick={() => setShowPrompt((v) => !v)}>
            {showPrompt ? 'Prompt ausblenden' : 'Prompt ansehen'}
          </button>
          {showPrompt && <textarea className="ai-prompt" readOnly rows={12} value={prompt} onFocus={(e) => e.currentTarget.select()} />}
        </Step>

        <Step n={++stepNo} title="Antwort der KI einfügen">
          <p className="muted small">
            Kopiere die Antwort der KI: am einfachsten mit dem „Kopieren“-Knopf direkt am Codeblock (der Kasten mit dem Ergebnis) – oder mit „Kopieren“
            unter der ganzen Antwort. Beides funktioniert. Füge sie dann hier ein.
          </p>
          {canReadClipboard && (
            <button className="btn ghost" onClick={pasteAnswer}>
              <Icon name="paste" size={18} /> Aus Zwischenablage einfügen
            </button>
          )}
          <textarea className="ai-answer" rows={6} value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Antwort der KI hier einfügen" spellCheck={false} />
          {answer && (
            <button className="link small" onClick={() => setAnswer('')}>
              Feld leeren
            </button>
          )}
          {parsed && 'err' in parsed && (
            <div className="notice critical stack">
              <span>{parsed.err}</span>
              <span className="small">
                Tipp: Schreib der KI „Bitte halte dich genau an das Antwortformat aus meinem Prompt und schick nur den Codeblock.“ und kopiere die neue
                Antwort.
              </span>
            </div>
          )}
          {ok && (
            <>
              <p className="notice good">
                <Icon name="check" size={18} /> {ok.summary}
              </p>
              {ok.warnings.length > 0 && (
                <div className="notice warning stack">
                  {ok.warnings.map((w) => (
                    <span key={w}>{w}</span>
                  ))}
                </div>
              )}
              <p className="muted small">
                Tippe unten auf „Im Editor öffnen“. Prüfe dort den Inhalt – auch eine KI macht Fehler – und tippe dann auf „Speichern“.
              </p>
            </>
          )}
        </Step>
      </div>

      {picking && (
        <MaterialPicker
          startId={folderId}
          selected={ids}
          onDone={(next) => {
            setIds(next);
            setPicking(false);
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </Sheet>
  );
}

/** Dateien (auch ganze Ordner) als Materialien auswählen – aus „Meine Ordner“ und geteilten Ordnern. */
function MaterialPicker({ startId, selected, onDone, onClose }: { startId: string; selected: string[]; onDone: (ids: string[]) => void; onClose: () => void }) {
  const { folders, files } = useLibrary();
  const [current, setCurrent] = useState<string | null>(startId);
  const [picked, setPicked] = useState<string[]>(selected);

  const inShared = current === SHARED_ROOT;
  const folder = current && !inShared ? folders.find((f) => f.id === current) ?? null : null;
  const path = inShared ? [] : pathOf(folders, current);
  const scope = scopeOf(folders, current);
  const kids = childFolders(folders, current);
  const here = folder ? filesIn(files, folder.id) : [];
  const sharedTops = childFolders(folders, SHARED_ROOT);
  const usableHere = here.filter((f) => routeGuess(f).route !== 'skip');
  const subtree = folder ? subtreeIds(folders, folder.id) : new Set<string>();
  const usableTree = folder ? files.filter((f) => subtree.has(f.folderId) && routeGuess(f).route !== 'skip') : [];
  const allTreePicked = usableTree.length > 0 && usableTree.every((f) => picked.includes(f.id));

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const toggleTree = () =>
    setPicked((p) => (allTreePicked ? p.filter((id) => !usableTree.some((f) => f.id === id)) : [...p, ...usableTree.map((f) => f.id).filter((id) => !p.includes(id))]));

  return (
    <Sheet
      title="Materialien auswählen"
      onClose={onClose}
      leading={
        current !== null ? (
          <button className="icon-btn" aria-label="Zurück" onClick={() => setCurrent(inShared ? null : folder?.parentId ?? null)}>
            <Icon name="back" />
          </button>
        ) : undefined
      }
      footer={
        <button className="btn primary grow" onClick={() => onDone(picked)}>
          Fertig{picked.length ? ` – ${picked.length} ${picked.length === 1 ? 'Datei' : 'Dateien'}` : ''}
        </button>
      }
    >
      <div className="picker stack">
        <nav className="crumbs" aria-label="Pfad">
          <button onClick={() => setCurrent(null)}>
            <Icon name="home" size={16} /> Ordner
          </button>
          {scope === 'shared' && (
            <span className="crumb">
              <Icon name="chevron" size={14} />
              <button onClick={() => setCurrent(SHARED_ROOT)}>Geteilte Ordner</button>
            </span>
          )}
          {path.map((p) => (
            <span key={p.id} className="crumb">
              <Icon name="chevron" size={14} />
              <button onClick={() => setCurrent(p.id)}>{p.name}</button>
            </span>
          ))}
        </nav>

        {folder && usableTree.length > 0 && (
          <button className="btn ghost" onClick={toggleTree}>
            <Icon name={allTreePicked ? 'close' : 'check'} size={18} />
            {allTreePicked
              ? 'Ganzen Ordner abwählen'
              : `Ganzen Ordner auswählen (${usableTree.length} ${usableTree.length === 1 ? 'Datei' : 'Dateien'}${usableTree.length > usableHere.length ? ', inkl. Unterordner' : ''})`}
          </button>
        )}

        {current === null && sharedTops.length > 0 && (
          <button className="card card-btn row-card" onClick={() => setCurrent(SHARED_ROOT)}>
            <span className="thumb folder-thumb">
              <Icon name="users" size={22} />
            </span>
            <div className="card-main">
              <strong className="ellipsis">Geteilte Ordner</strong>
              <span className="muted small ellipsis">{sharedTops.length} geteilt mit dir</span>
            </div>
            <Icon name="chevron" />
          </button>
        )}

        {kids.length > 0 && (
          <ul className="list">
            {kids.map((k) => (
              <li key={k.id}>
                <button className="card card-btn row-card" onClick={() => setCurrent(k.id)}>
                  <FolderThumb folder={k} />
                  <div className="card-main">
                    <strong className="wrap-text">{k.name}</strong>
                  </div>
                  <Icon name="chevron" />
                </button>
              </li>
            ))}
          </ul>
        )}

        {here.length > 0 && (
          <ul className="list">
            {here.map((f) => {
              const g = routeGuess(f);
              const on = picked.includes(f.id);
              return (
                <li key={f.id}>
                  <label className={`card row-card ai-pick${g.route === 'skip' ? ' disabled' : ''}${on ? ' on' : ''}`}>
                    <input type="checkbox" checked={on} disabled={g.route === 'skip'} onChange={() => toggle(f.id)} />
                    <FileThumb file={f} />
                    <div className="card-main">
                      <strong className="wrap-text">{fullName(f)}</strong>
                      <span className="muted small">
                        {g.route === 'skip' ? `${g.label} – geht leider nicht` : g.route === 'text' ? `${g.label} – Text kommt in den Prompt` : `${g.label} – direkt an die KI`}
                      </span>
                    </div>
                  </label>
                </li>
              );
            })}
          </ul>
        )}

        {folder && kids.length === 0 && here.length === 0 && <EmptyState title="Leerer Ordner" />}
        {current === null && kids.length === 0 && <EmptyState title="Noch keine Ordner" />}
      </div>
    </Sheet>
  );
}
