// „Mit KI erstellen“: Für jede Art von Lern-Datei ein genauer Prompt und das passende Einlesen der Antwort.
import type { IconName } from '../../components/Icon';
import { fullName } from '../../lib/files';
import { parseCards, parseQuiz, type Card, type Question } from '../study/format';
import { CHART_TYPES, MAX_POINTS, parseChart, type Chart, type ChartType } from '../charts/chart';
import { MAX_ENTRIES, parseWheel, type Wheel } from '../wheel/wheel';
import { gapsOf, parseGapsDoc, type GapsDoc } from '../gaps/gaps';
import { extractJson, markdownToHtml, splitTitle, unfence } from './answer';
import { attachmentsOf, type Material } from './materials';

export type AiKind = 'cards' | 'quiz' | 'gaps' | 'doc' | 'note' | 'chart' | 'wheel';

export interface AiSettings {
  kind: AiKind;
  topic: string;
  language: 'de' | 'en' | 'material';
  level: 'basic' | 'medium' | 'exam';
  /** Anzahl Karten / Fragen / Datenpunkte / Einträge */
  count: number;
  extra: string;
  cardStyle: 'mixed' | 'term' | 'question';
  answers: number;
  multi: boolean;
  docStyle: 'summary' | 'sheet' | 'explain' | 'outline';
  length: 'short' | 'medium' | 'long';
  chartType: 'auto' | ChartType;
  noteStyle: 'bullets' | 'summary';
  removePicked: boolean;
}

export const DEFAULT_SETTINGS: AiSettings = {
  kind: 'cards',
  topic: '',
  language: 'material',
  level: 'medium',
  count: 20,
  extra: '',
  cardStyle: 'mixed',
  answers: 4,
  multi: false,
  docStyle: 'summary',
  length: 'medium',
  chartType: 'auto',
  noteStyle: 'bullets',
  removePicked: false,
};

export type AiResult = (
  | { kind: 'cards'; title: string; cards: Card[] }
  | { kind: 'quiz'; title: string; questions: Question[] }
  | { kind: 'gaps'; title: string; doc: GapsDoc }
  | { kind: 'chart'; title: string; chart: Chart }
  | { kind: 'wheel'; title: string; wheel: Wheel }
  | { kind: 'doc'; title: string; html: string }
  | { kind: 'note'; title: string; text: string }
) & {
  /** Kurze Beschreibung der Datei (von der KI) */
  description?: string;
};

export interface Parsed {
  result: AiResult;
  /** z. B. „24 Karten erkannt“ */
  summary: string;
  warnings: string[];
}

export const KINDS: {
  id: AiKind;
  icon: IconName;
  label: string;
  /** Was die Anzahl zählt (oder null = keine Anzahl) */
  count: { label: string; min: number; max: number; def: number } | null;
  /** Kurze Erklärung im Auswahl-Schritt */
  text: string;
}[] = [
  { id: 'cards', icon: 'cards', label: 'Karteikarten', count: { label: 'Anzahl Karten', min: 3, max: 150, def: 20 }, text: 'Vorder- und Rückseite zum Lernen' },
  { id: 'quiz', icon: 'quiz', label: 'Quiz', count: { label: 'Anzahl Fragen', min: 3, max: 60, def: 10 }, text: 'Multiple Choice mit Erklärungen' },
  { id: 'gaps', icon: 'gaps', label: 'Lückentext', count: { label: 'Anzahl Lücken', min: 3, max: 60, def: 12 }, text: 'Wörter einsetzen oder selbst schreiben' },
  { id: 'doc', icon: 'richdoc', label: 'Text-Dokument', count: null, text: 'Zusammenfassung, Lernzettel, Erklärung …' },
  { id: 'note', icon: 'text', label: 'Notiz', count: null, text: 'Kurzer reiner Text' },
  { id: 'chart', icon: 'chart', label: 'Diagramm', count: { label: 'Höchstens Datenpunkte', min: 2, max: MAX_POINTS, def: 8 }, text: 'Zahlen als Säulen, Linie, Kreis …' },
  { id: 'wheel', icon: 'wheel', label: 'Glücksrad', count: { label: 'Anzahl Einträge', min: 2, max: MAX_ENTRIES, def: 12 }, text: 'Zufällig Themen oder Aufgaben ziehen' },
];
export const kindInfo = (k: AiKind) => KINDS.find((x) => x.id === k)!;

const LEVEL: Record<AiSettings['level'], string> = {
  basic: 'Grundlagen – wichtigste Begriffe, Definitionen und einfache Beispiele; für jemanden, der gerade erst anfängt.',
  medium: 'Mittel – Begriffe, Definitionen, Zusammenhänge und typische Beispiele; wie in einer normalen Übung.',
  exam: 'Prüfungsniveau (anspruchsvoll) – Anwendung, Begründungen, Herleitungen, Vergleiche und Transfer statt bloßem Wiedererkennen; typische Fehler und Fallen; so schwer, wie es in einer guten Prüfung drankommen könnte. Wer nur oberflächlich gelernt hat, soll hier scheitern.',
};
const LANGUAGE: Record<AiSettings['language'], string> = {
  de: 'Deutsch',
  en: 'Englisch',
  material: 'dieselbe Sprache wie die Materialien (ohne Materialien: Deutsch)',
};

const usable = (mats: Material[]) => mats.filter((m) => (m.route === 'text' && m.text) || attachmentsOf(m).length > 0);

// ---------- Bausteine ----------

function sources(s: AiSettings, mats: Material[]): string {
  const text = mats.filter((m) => m.route === 'text' && m.text);
  const files = mats.flatMap(attachmentsOf);
  if (!text.length && !files.length) {
    return `## Quellen
Ich gebe dir keine Materialien mit. Nutze dein Fachwissen${s.topic.trim() ? ` zum Thema „${s.topic.trim()}“` : ''}.
- Schreibe nur Dinge, bei denen du dir sicher bist und die fachlich korrekt sind. Lieber etwas weniger, dafür richtig.
- Verwende die Fachsprache und Notation, die an Universitäten und in Lehrbüchern üblich ist.
- Wenn das Thema mehrdeutig ist, wähle die im Studium übliche Bedeutung.`;
  }
  const lines = ['## Quellen'];
  if (text.length)
    lines.push(
      `Ganz unten im Abschnitt „MATERIALIEN“ ${text.length === 1 ? 'steht eine Datei' : `stehen ${text.length} Dateien`} als Text (der Dateiname steht jeweils in der Kopfzeile „===== MATERIAL …“).`,
    );
  if (files.length)
    lines.push(
      `${text.length ? 'Zusätzlich hänge' : 'Ich hänge'} ich ${files.length === 1 ? 'eine Datei' : `${files.length} Dateien`} direkt an diese Nachricht an: ${files.map((f) => `„${f.name}“`).join(', ')}. Lies ${files.length === 1 ? 'sie' : 'sie alle'} vollständig und sorgfältig – auch Handschrift, Tafelbilder, Tabellen, Skizzen und Diagramme darin. Wenn du eine angekündigte Datei nicht siehst oder nicht lesen kannst, sag mir das in einem Satz, statt etwas zu erfinden.`,
    );
  lines.push(
    ...(files.length && text.length
      ? ['- Im Text stehen Platzhalter wie „[Bild: siehe angehängte Datei „…“]“. Dort gehört das jeweilige angehängte Bild hin – beziehe es an dieser Stelle mit ein (z. B. Tafelbilder, Skizzen, Diagramme, Tabellen als Bild).']
      : []),
    '- Stütze dich ausschließlich auf diese Materialien. Sie sind die Grundlage – nicht dein Allgemeinwissen.',
    s.kind === 'quiz'
      ? '- Richtige Antworten und Erklärungen: nichts erfinden – sie müssen durch die Materialien gedeckt sein. Ergänze höchstens gesichertes Grundwissen, das direkt dazugehört.'
      : '- Erfinde nichts dazu. Ergänze höchstens gesichertes Grundwissen, das zum Verständnis direkt dazugehört.',
    ...(s.kind === 'quiz'
      ? ['- AUSNAHME – falsche Antworten: Die darfst und sollst du frei erfinden (siehe „Regeln für die falschen Antworten“). Sie müssen nicht aus den Materialien stammen, nur laut Materialien eindeutig falsch sein.']
      : []),
    '- Übernimm Fachbegriffe, Schreibweisen, Bezeichnungen und Notation (Variablennamen, Symbole, Definitionen) genau so wie in den Materialien – auch wenn du es anders gewohnt bist.',
    '- Decke die Materialien möglichst gleichmäßig ab – nicht nur den Anfang. Wichtiges (Definitionen, Sätze, Merksätze, hervorgehobene Stellen) hat Vorrang.',
    '- Ignoriere Kopf- und Fußzeilen, Seitenzahlen, Inhaltsverzeichnisse, Literaturangaben und Organisatorisches (Termine, Abgaberegeln, Raumangaben).',
  );
  if (s.topic.trim()) lines.push(`- Konzentriere dich innerhalb der Materialien auf: ${s.topic.trim()}`);
  return lines.join('\n');
}

const MATH_TEXT = `## Formeln
Falls Formeln, mathematische Symbole oder Größen mit Hoch-/Tiefzahlen vorkommen, schreibe sie in LaTeX:
- im Text zwischen einfachen Dollarzeichen, z. B. $a^2 + b^2 = c^2$ oder $x_n \\to 0$
- als eigene, abgesetzte Formel zwischen doppelten Dollarzeichen, z. B. $$\\int_0^1 x\\,dx = \\tfrac{1}{2}$$
- Direkt nach dem öffnenden und direkt vor dem schließenden $ steht kein Leerzeichen.
- Benutze keine anderen Schreibweisen wie \\( … \\) oder \\[ … \\] und keinen Unicode-Ersatz wie x² oder √ für Formeln.
- Ein normales Dollarzeichen (Geldbetrag) schreibst du als \\$.`;

const MATH_JSON = `${MATH_TEXT}
- SEHR WICHTIG für JSON: Jeder Backslash muss im JSON-Text verdoppelt werden. Richtig: "$\\\\frac{a}{b}$" – falsch: "$\\frac{a}{b}$". Sonst wird z. B. \\f, \\b, \\n oder \\t als Steuerzeichen gelesen und die Formel ist kaputt. Das gilt für alle LaTeX-Befehle: \\\\alpha, \\\\sum, \\\\int, \\\\mathbb{R}, \\\\text{…}, \\\\cdot, \\\\le, \\\\infty …`;

function settingsBlock(s: AiSettings, mats: Material[], parts: string[]): string {
  const lines = ['## Deine Aufgabe', ...parts];
  if (s.topic.trim() && !usable(mats).length) lines.push(`- Thema: ${s.topic.trim()}`);
  lines.push(`- Niveau: ${LEVEL[s.level]}`);
  lines.push(`- Sprache des Inhalts: ${LANGUAGE[s.language]}. Auch der Titel ist in dieser Sprache.${s.kind === 'doc' || s.kind === 'note' ? '' : ' Die JSON-Feldnamen (z. B. "title") bleiben aber immer genau wie in der Vorlage.'}`);
  if (s.extra.trim()) lines.push(`- Zusätzliche Wünsche (haben Vorrang vor den allgemeinen Regeln, aber nicht vor dem Antwortformat): ${s.extra.trim()}`);
  return lines.join('\n');
}

function materialsBlock(mats: Material[]): string {
  const text = mats.filter((m) => m.route === 'text' && m.text);
  if (!text.length) return '';
  return [
    '=============== MATERIALIEN (Anfang) ===============',
    ...text.map((m, i) => `\n===== MATERIAL ${i + 1}: ${fullName(m.file)} =====\n${m.text}`),
    '',
    '=============== MATERIALIEN (Ende) ===============',
  ].join('\n');
}

const INTRO = (what: string) => `# Auftrag
Du bist ein erfahrener, genauer Tutor und erstellst ${what} für meine Lern-App („Lernapp“).
Deine Antwort wird nicht von einem Menschen gelesen, sondern von einem Programm automatisch eingelesen. Halte dich deshalb exakt an das Antwortformat weiter unten. Schon kleine Abweichungen (Text vor oder nach dem Codeblock, andere Feldnamen, fehlende Anführungszeichen) können dazu führen, dass nichts importiert wird.`;

function jsonAnswerRules(extra: string[]): string {
  return `## Antwortformat (exakt einhalten)
- Antworte mit genau einem Codeblock, der mit \`\`\`json beginnt und mit \`\`\` endet.
- Vor und nach dem Codeblock steht nichts – keine Einleitung, keine Erklärung, keine Rückfrage.
- Im Codeblock steht genau ein gültiges JSON-Objekt: doppelte Anführungszeichen ("), keine Kommentare, kein Komma nach dem letzten Element.
- Verwende genau die Feldnamen aus der Vorlage – keine zusätzlichen Felder und keine "id"-Felder (die vergibt die App selbst).
- Zeilenumbrüche innerhalb eines Textes schreibst du als \\n.
${extra.map((e) => `- ${e}`).join('\n')}`;
}

const SELF_CHECK = (items: string[]) => `## Bevor du antwortest
Prüfe still für dich (gib diese Prüfung nicht aus):
${items.map((i) => `- ${i}`).join('\n')}`;

const finalReminder = (items: string[]) => `## Zum Schluss nochmal das Wichtigste
${items.map((i) => `- ${i}`).join('\n')}`;

const JSON_REMINDER = [
  'Nur ein einziger ```json-Codeblock, nichts davor und nichts danach.',
  'Genau die Feldnamen aus der Vorlage, keine "id"-Felder.',
  'In Formeln jeden Backslash verdoppeln ($\\\\frac{1}{2}$, nicht $\\frac{1}{2}$).',
];

const join = (parts: string[]) => parts.filter(Boolean).join('\n\n');

// ---------- Prompts ----------

function cardsPrompt(s: AiSettings, mats: Material[]): string {
  const hasMats = usable(mats).length > 0;
  const style = {
    term: 'Vorderseite: ein Fachbegriff, Name, Satz oder eine Formelbezeichnung (z. B. „Satz von Pythagoras“). Rückseite: die genaue Definition bzw. Aussage und, wenn sinnvoll, ein kurzes Beispiel.',
    question: 'Vorderseite: eine konkrete, eindeutige Frage. Rückseite: die vollständige, aber knappe Antwort.',
    mixed: 'Mische Begriffs-Karten (Begriff → Definition/Aussage) und Frage-Karten (Frage → Antwort) – je nachdem, was für den Inhalt besser passt.',
  }[s.cardStyle];
  return join([
    INTRO('Karteikarten'),
    settingsBlock(s, mats, [
      hasMats
        ? `- Erstelle ${s.count} Karteikarten. Gibt das Material dafür nicht genug her, erstelle lieber weniger, aber keine Wiederholungen oder Füllkarten.`
        : `- Erstelle genau ${s.count} Karteikarten.`,
      `- Art der Karten: ${style}`,
    ]),
    sources(s, mats),
    `## Regeln für gute Karteikarten
- Eine Karte = ein Lerninhalt. Lieber zwei kleine Karten als eine überladene.
- Die Vorderseite ist kurz (ein Begriff oder höchstens 1–2 Sätze) und ohne die anderen Karten verständlich.
- Die Vorderseite verrät die Antwort nicht.
- Die Rückseite ist präzise und vollständig: meist 1–4 Sätze oder eine kurze Aufzählung (jede Zeile beginnt mit "- ", Zeilen getrennt durch \\n).
- Keine Ja/Nein-Fragen, keine Verweise wie „siehe Karte 3“ oder „wie oben“.
- Keine doppelten oder fast gleichen Karten.
- Sinnvolle Reihenfolge: von den Grundlagen zu den schwierigeren Inhalten, Zusammengehöriges nacheinander.
- Bei Definitionen und Sätzen alle Voraussetzungen nennen – nichts weglassen, was die Aussage verfälscht.`,
    MATH_JSON,
    jsonAnswerRules([`"cards" enthält die Karten in der gewünschten Reihenfolge.`, `"title" ist ein kurzer, passender Name für den Kartenstapel (höchstens 60 Zeichen).`, `"description" ist eine kurze Beschreibung (ein Satz, höchstens 150 Zeichen), worum es geht – z. B. Thema, Kapitel oder Umfang. Lass sie nur dann leer (""), wenn ich in meinen Wünschen ausdrücklich keine Beschreibung möchte.`]),
    `## Vorlage
\`\`\`json
{
  "title": "Kurzer Name für den Stapel",
  "description": "Ein Satz, worum es geht",
  "cards": [
    { "front": "Vorderseite", "back": "Rückseite" }
  ]
}
\`\`\`

## Beispiel (nur zur Veranschaulichung des Formats – nicht übernehmen)
\`\`\`json
{
  "title": "Analysis – Ableitungen",
  "description": "Grundlegende Ableitungsregeln mit Beispielen aus Kapitel 2",
  "cards": [
    { "front": "Satz des Pythagoras", "back": "In einem rechtwinkligen Dreieck mit Hypotenuse $c$ gilt $a^2 + b^2 = c^2$." },
    { "front": "Was ist die Ableitung von $\\\\sin x$?", "back": "$\\\\frac{d}{dx}\\\\sin x = \\\\cos x$" },
    { "front": "Kettenregel", "back": "Für $h(x) = f(g(x))$ gilt:\\n$$h'(x) = f'(g(x)) \\\\cdot g'(x)$$" }
  ]
}
\`\`\``,
    SELF_CHECK([
      `Sind es ${hasMats ? `höchstens ${s.count}` : `genau ${s.count}`} Karten, ohne Doppelungen?`,
      'Ist jede Rückseite fachlich korrekt und passt sie genau zur Vorderseite?',
      hasMats ? 'Stammt jeder Inhalt aus den Materialien, und sind diese gleichmäßig abgedeckt?' : 'Ist alles gesichertes Fachwissen?',
      'Ist das JSON gültig, und sind in Formeln alle Backslashes verdoppelt?',
    ]),
    materialsBlock(mats),
    finalReminder([...JSON_REMINDER, `${hasMats ? `Bis zu ${s.count}` : `Genau ${s.count}`} Karten, Sprache: ${LANGUAGE[s.language]}.`]),
  ]);
}

function quizPrompt(s: AiSettings, mats: Material[]): string {
  const hasMats = usable(mats).length > 0;
  return join([
    INTRO('ein Multiple-Choice-Quiz'),
    settingsBlock(s, mats, [
      hasMats
        ? `- Erstelle ${s.count} Fragen. Gibt das Material dafür nicht genug her, erstelle lieber weniger, aber keine Wiederholungen.`
        : `- Erstelle genau ${s.count} Fragen.`,
      `- Jede Frage hat genau ${s.answers} Antwortmöglichkeiten.`,
      s.multi
        ? '- Bei manchen Fragen dürfen mehrere Antworten richtig sein (mindestens eine ist immer richtig). Formuliere solche Fragen so, dass klar ist, dass mehrere stimmen können (z. B. „Welche Aussagen sind richtig?“).'
        : '- Bei jeder Frage ist genau eine Antwort richtig.',
    ]),
    sources(s, mats),
    `## Regeln für gute Quizfragen
- Jede Frage ist für sich allein verständlich und eindeutig – mit dem nötigen Wissen gibt es keinen Zweifel, was richtig ist.
- Abwechslungsreich: Verständnis, Anwendung, Vergleiche und Zusammenhänge – nicht nur Definitionen oder Jahreszahlen abfragen.
- Keine Antworten wie „Alle genannten“, „Keine der Antworten“ oder „A und B“.
- Die richtige Antwort steht an wechselnden Positionen (nicht immer an derselben Stelle).
- Möglichst keine verneinten Fragen. Wenn doch, schreibe das NICHT in Großbuchstaben.
- "explanation": 1–3 Sätze, warum die richtige Antwort stimmt und warum der verlockendste Fehler falsch ist.

## Regeln für die falschen Antworten (Distraktoren) – das Wichtigste am ganzen Quiz
Ein Quiz ist nur so gut wie seine falschen Antworten. Sie müssen so überzeugend sein, dass nur jemand, der den Stoff wirklich kann, sicher die richtige findet.
- Erfinde sie frei. Gute Quellen für falsche Antworten: knapp danebenliegende Zahlen und Jahreszahlen (z. B. 4. oder 6. statt 5. Jahrhundert), vertauschte Merkmale, plausible, aber falsche Deutungen oder Symbolik, Merkmale aus derselben Epoche/demselben Gebiet, die aber hier nicht zutreffen, typische Denkfehler und Verwechslungen.
- „Knapp daneben“: Eine falsche Antwort unterscheidet sich von der richtigen möglichst nur in einem (höchstens zwei) Details – der Rest ist identisch oder genauso plausibel.
- Gleiche Form: Alle Antworten einer Frage sind gleich aufgebaut, ähnlich lang, gleich genau und im gleichen Stil. Die richtige Antwort darf nicht die längste, genaueste oder „vorsichtigste“ sein und nicht als einzige Wörter aus der Frage wiederholen.
- VERBOTEN – Antworten, die sich ohne Fachwissen ausschließen lassen:
  - Namen, Personen, Orte, Gegenstände oder Jahreszahlen, die erkennbar zu einem anderen Thema/Werk gehören als dem, nach dem gefragt wird (z. B. bei einer Frage zu Werk A eine Antwort, die eine Person aus Werk B nennt).
  - Antworten, die einfach die Beschreibung eines anderen Themas aus den Materialien sind.
  - Absurde, witzige, offensichtlich übertriebene oder widersprüchliche Antworten.
- Lieber eine Antwort, die zu 90 % stimmt und nur ein falsches Detail enthält, als eine, die komplett falsch ist.
- Jede falsche Antwort muss trotzdem eindeutig falsch sein – nichts, worüber man streiten könnte.${s.level === 'exam' ? '\n- Auf Prüfungsniveau gilt das für JEDE Frage: alle falschen Antworten knapp daneben.' : s.level === 'basic' ? '\n- Auf Grundlagen-Niveau dürfen die falschen Antworten etwas deutlicher abweichen – aber trotzdem plausibel und ohne Hinweise aus anderen Themen.' : ''}`,
    MATH_JSON,
    jsonAnswerRules([
      `Jede Antwort hat "correct": true oder "correct": false (ohne Anführungszeichen).`,
      `"title" ist ein kurzer, passender Name für das Quiz (höchstens 60 Zeichen).`,
      `"description" ist eine kurze Beschreibung (ein Satz, höchstens 150 Zeichen), worum es geht – z. B. Thema, Kapitel oder Umfang. Lass sie nur dann leer (""), wenn ich in meinen Wünschen ausdrücklich keine Beschreibung möchte.`,
    ]),
    `## Vorlage
\`\`\`json
{
  "title": "Kurzer Name für das Quiz",
  "description": "Ein Satz, worum es geht",
  "questions": [
    {
      "text": "Frage",
      "answers": [
        { "text": "Antwort", "correct": false },
        { "text": "Antwort", "correct": true }
      ],
      "explanation": "Warum die richtige Antwort stimmt"
    }
  ]
}
\`\`\`

## Beispiele (nur zur Veranschaulichung von Format und Schwierigkeit – nicht übernehmen)
Beachte, wie die falschen Antworten jeweils nur in einem Detail abweichen:
\`\`\`json
{
  "title": "Beispiele",
  "description": "Zwei Beispielfragen mit knapp danebenliegenden falschen Antworten",
  "questions": [
    {
      "text": "Welche Kombination passt zum Kölner Dom?",
      "answers": [
        { "text": "Baubeginn 1248, romanischer Stil, Fertigstellung 1880", "correct": false },
        { "text": "Baubeginn 1248, gotischer Stil, Fertigstellung 1880", "correct": true },
        { "text": "Baubeginn 1348, gotischer Stil, Fertigstellung 1880", "correct": false },
        { "text": "Baubeginn 1248, gotischer Stil, Fertigstellung 1780", "correct": false }
      ],
      "explanation": "Der Dom wurde 1248 im gotischen Stil begonnen und erst 1880 vollendet. Die romanische Variante ist verlockend, weil viele ältere Kölner Kirchen romanisch sind."
    },
    {
      "text": "Für $f(x) = x^3$ gilt:",
      "answers": [
        { "text": "$f'(x) = 3x^2$, also $f'(2) = 6$", "correct": false },
        { "text": "$f'(x) = 3x^3$, also $f'(2) = 24$", "correct": false },
        { "text": "$f'(x) = 3x^2$, also $f'(2) = 12$", "correct": true },
        { "text": "$f'(x) = x^2$, also $f'(2) = 4$", "correct": false }
      ],
      "explanation": "Nach der Potenzregel ist $f'(x) = 3x^2$ und damit $f'(2) = 3 \\cdot 4 = 12$. Wer $3 \\cdot 2$ rechnet, vergisst das Quadrat."
    }
  ]
}
\`\`\``,
    SELF_CHECK([
      `Sind es ${hasMats ? `höchstens ${s.count}` : `genau ${s.count}`} Fragen mit je genau ${s.answers} Antworten?`,
      s.multi ? 'Ist bei jeder Frage mindestens eine Antwort richtig?' : 'Ist bei jeder Frage genau eine Antwort richtig?',
      'Ist jede als richtig markierte Antwort wirklich richtig und jede als falsch markierte wirklich falsch?',
      'Steht die richtige Antwort an wechselnden Positionen?',
      'Könnte jemand, der NICHT gelernt hat, die richtige Antwort durch Ausschließen finden (weil eine falsche Antwort zu einem anderen Thema gehört, absurd ist oder anders formuliert ist)? Dann schreibe die falschen Antworten um.',
      'Weicht jede falsche Antwort nur in einem oder zwei Details von der richtigen ab und ist trotzdem eindeutig falsch?',
      'Ist das JSON gültig, und sind in Formeln alle Backslashes verdoppelt?',
    ]),
    materialsBlock(mats),
    finalReminder([
      ...JSON_REMINDER,
      `${hasMats ? `Bis zu ${s.count}` : `Genau ${s.count}`} Fragen mit je ${s.answers} Antworten, Sprache: ${LANGUAGE[s.language]}.`,
      'Falsche Antworten frei erfinden, knapp daneben, gleich aufgebaut wie die richtige – keine Begriffe aus anderen Themen, nichts, was man ohne Wissen ausschließen kann.',
    ]),
  ]);
}

function chartPrompt(s: AiSettings, mats: Material[]): string {
  const hasMats = usable(mats).length > 0;
  const types = CHART_TYPES.map((t) => `"${t.id}" (${t.label})`).join(', ');
  return join([
    INTRO('ein Diagramm'),
    settingsBlock(s, mats, [
      `- Erstelle ein Diagramm mit höchstens ${s.count} Datenpunkten (Werten).`,
      s.chartType === 'auto'
        ? '- Wähle den passenden Diagrammtyp: "bar" (Säulen) für Vergleiche, "hbar" (Balken) bei langen Beschriftungen, "line" (Linie) für Entwicklungen über die Zeit, "pie" (Kreis) oder "donut" (Ring) für Anteile an einem Ganzen mit höchstens 8 Teilen.'
        : `- Diagrammtyp: "${s.chartType}" (${CHART_TYPES.find((t) => t.id === s.chartType)?.label}).`,
    ]),
    sources(s, mats),
    `## Regeln für die Daten
- ERFINDE KEINE ZAHLEN. ${hasMats ? 'Nimm die Werte aus den Materialien.' : 'Verwende nur allgemein bekannte, gesicherte Daten.'}
- Sind die Werte nur gerundet oder geschätzt, schreibe „(ca.)“ in den Titel. Gibt es keine echten Daten, nimm erkennbare Beispielwerte und schreibe „(Beispielwerte)“ in den Titel.
- "value" ist immer eine reine Zahl: Punkt als Dezimaltrennzeichen, keine Tausenderpunkte, keine Einheit, keine Anführungszeichen (z. B. 1234.5).
- Die Einheit steht einmal in "unit" (höchstens 12 Zeichen, z. B. "%", "€", "km/h", "°C") – oder leer "".
- "label" ist kurz (am besten höchstens 25 Zeichen), damit es ins Diagramm passt.
- Bei "line" sind die Punkte zeitlich bzw. nach der x-Achse sortiert. Bei "pie"/"donut" sind alle Werte positiv und ergeben zusammen das Ganze.
- "showValues": true zeigt die Zahlen am Diagramm an (meist sinnvoll), false blendet sie aus.
- Mögliche Werte für "chart": ${types}.`,
    jsonAnswerRules([`"title" beschreibt, was das Diagramm zeigt (inkl. Zeitraum/Quelle, falls bekannt; höchstens 120 Zeichen).`, `"description" ist eine kurze Beschreibung (ein Satz, höchstens 150 Zeichen), worum es geht – z. B. Thema, Kapitel oder Umfang. Lass sie nur dann leer (""), wenn ich in meinen Wünschen ausdrücklich keine Beschreibung möchte.`]),
    `## Vorlage
\`\`\`json
{
  "title": "Was das Diagramm zeigt",
  "description": "Ein Satz, worum es geht",
  "chart": "bar",
  "unit": "",
  "showValues": true,
  "points": [
    { "label": "Beschriftung", "value": 12.5 }
  ]
}
\`\`\`

## Beispiel (nur zur Veranschaulichung des Formats – nicht übernehmen)
\`\`\`json
{
  "title": "Notenverteilung Klausur Analysis 1 (Beispielwerte)",
  "description": "Anteil der Noten in Prozent, erfundene Beispielwerte",
  "chart": "bar",
  "unit": "%",
  "showValues": true,
  "points": [
    { "label": "Sehr gut", "value": 12 },
    { "label": "Gut", "value": 21.5 },
    { "label": "Befriedigend", "value": 30 },
    { "label": "Genügend", "value": 18.5 },
    { "label": "Nicht genügend", "value": 18 }
  ]
}
\`\`\``,
    SELF_CHECK([`Höchstens ${s.count} Punkte?`, 'Stimmen alle Zahlen mit der Quelle überein, und ist kein Wert erfunden?', 'Ist jedes "value" eine reine Zahl?', 'Ist das JSON gültig?']),
    materialsBlock(mats),
    finalReminder(['Nur ein einziger ```json-Codeblock, nichts davor und nichts danach.', 'Keine erfundenen Zahlen; "value" nur als Zahl.', `Beschriftungen in: ${LANGUAGE[s.language]}.`]),
  ]);
}

function wheelPrompt(s: AiSettings, mats: Material[]): string {
  return join([
    INTRO('ein Glücksrad'),
    settingsBlock(s, mats, [
      `- Erstelle ein Glücksrad mit ${s.count} Einträgen. Typisch sind Themen zum Wiederholen, Begriffe zum Erklären oder Aufgaben – richte dich nach dem Thema und den Wünschen.`,
      s.removePicked
        ? '- "removePicked": true – ein gezogener Eintrag kommt bis zum Zurücksetzen nicht noch einmal dran.'
        : '- "removePicked": false – jeder Eintrag kann mehrmals gezogen werden.',
    ]),
    sources(s, mats),
    `## Regeln für die Einträge
- Jeder Eintrag ist kurz, damit er ins Rad passt: am besten 1–4 Wörter, höchstens 40 Zeichen.
- Keine doppelten oder fast gleichen Einträge.
- "weight" ist eine ganze Zahl von 1 bis 10 und bestimmt die Größe des Feldes (2 = kommt doppelt so oft wie 1). Nimm normalerweise 1; nur besonders wichtige Einträge bekommen 2 oder 3.
- Formeln sind möglich ($…$), sollten im Rad aber die Ausnahme sein.`,
    MATH_JSON,
    jsonAnswerRules([`"title" ist ein kurzer, passender Name (höchstens 60 Zeichen).`, `"description" ist eine kurze Beschreibung (ein Satz, höchstens 150 Zeichen), worum es geht – z. B. Thema, Kapitel oder Umfang. Lass sie nur dann leer (""), wenn ich in meinen Wünschen ausdrücklich keine Beschreibung möchte.`]),
    `## Vorlage
\`\`\`json
{
  "title": "Kurzer Name",
  "description": "Ein Satz, worum es geht",
  "removePicked": ${s.removePicked},
  "entries": [
    { "label": "Eintrag", "weight": 1 }
  ]
}
\`\`\`

## Beispiel (nur zur Veranschaulichung des Formats – nicht übernehmen)
\`\`\`json
{
  "title": "Wiederholung Lineare Algebra",
  "description": "Zufällig ein Thema zum Wiederholen ziehen",
  "removePicked": ${s.removePicked},
  "entries": [
    { "label": "Basis & Dimension", "weight": 2 },
    { "label": "Lineare Abbildungen", "weight": 1 },
    { "label": "Determinante", "weight": 1 },
    { "label": "Eigenwerte", "weight": 2 }
  ]
}
\`\`\``,
    SELF_CHECK([`Genau ${s.count} Einträge, alle kurz und verschieden?`, 'Ist "weight" überall eine ganze Zahl von 1 bis 10?', 'Ist das JSON gültig?']),
    materialsBlock(mats),
    finalReminder(['Nur ein einziger ```json-Codeblock, nichts davor und nichts danach.', `Genau ${s.count} kurze Einträge, Sprache: ${LANGUAGE[s.language]}.`]),
  ]);
}

function gapsPrompt(s: AiSettings, mats: Material[]): string {
  const hasMats = usable(mats).length > 0;
  return join([
    INTRO('einen Lückentext'),
    settingsBlock(s, mats, [
      `- Schreibe einen zusammenhängenden Lerntext mit ${hasMats ? `bis zu ${s.count}` : `genau ${s.count}`} Lücken.`,
      '- Der Text erklärt das Thema in ganzen Sätzen und logischer Reihenfolge – keine Liste unverbundener Einzelsätze.',
      '- Dazu kommen 4–8 Ablenkwörter (falsche Wörter für den Modus „Wörter einsetzen“).',
    ]),
    sources(s, mats),
    `## Regeln für gute Lücken
- Lücken nur bei Wörtern, die man wirklich lernen muss: Fachbegriffe, Namen, Fachverben, wichtige Zahlen und Jahreszahlen. NIE bei Füllwörtern, Artikeln, Präpositionen oder Wörtern, die sich aus dem Satz von selbst ergeben.
- Eine Lücke umfasst 1 Wort (höchstens 3 Wörter, z. B. ein feststehender Begriff).
- Höchstens eine Lücke pro Satz (bei langen Sätzen zwei) und gleichmäßig über den Text verteilt.
- Jede Lücke muss aus dem Zusammenhang eindeutig sein – man soll sie auch selbst hinschreiben können. Passen mehrere Wörter, formuliere den Satz um oder gib die gleichwertigen Antworten mit | an: [[Prophase|Vorphase]].
- Die Grammatik darf die Lösung nicht verraten (z. B. kein „ein“/„eine“ direkt davor, das nur zu einem einzigen Wort passt).
- Keine Lücken innerhalb von Formeln ($…$).
- Schreibweise der Lücken: doppelte eckige Klammern direkt im Text, z. B. „Die [[Mitose]] besteht aus vier Phasen.“

## Regeln für die Ablenkwörter
- Erfinde sie frei – sie müssen nicht aus den Materialien stammen.
- Sie stammen aus demselben Themengebiet und haben dieselbe Wortart und grammatische Form wie die Lösungen (z. B. Nomen im selben Fall, Verben in derselben Form), damit sie grammatisch in mehrere Lücken passen würden.
- Typisch: verwandte, leicht verwechselbare Begriffe (z. B. „Meiose“ zu „Mitose“, „Interphase“ zu „Prophase“) oder knapp danebenliegende Zahlen.
- Kein Ablenkwort darf in irgendeine Lücke richtig passen – auch kein Synonym einer Lösung.`,
    MATH_JSON,
    jsonAnswerRules([
      `"text" ist der ganze Lückentext als ein String; Absätze mit \\n\\n trennen.`,
      `"distractors" ist eine Liste mit 4–8 Ablenkwörtern.`,
      `"title" ist ein kurzer, passender Name (höchstens 60 Zeichen).`,
      '`"description" ist eine kurze Beschreibung (ein Satz, höchstens 150 Zeichen), worum es geht. Lass sie nur dann leer (""), wenn ich in meinen Wünschen ausdrücklich keine Beschreibung möchte.`',
    ]),
    `## Vorlage
\`\`\`json
{
  "title": "Kurzer Name",
  "description": "Ein Satz, worum es geht",
  "text": "Text mit [[Lücke]] und noch einer [[Lücke|Alternative]].",
  "distractors": ["Ablenkwort", "Ablenkwort"]
}
\`\`\`

## Beispiel (nur zur Veranschaulichung von Format und Schwierigkeit – nicht übernehmen)
\`\`\`json
{
  "title": "Zellteilung",
  "description": "Ablauf der Mitose und ihre Phasen",
  "text": "Bei der [[Mitose]] entstehen aus einer Zelle zwei genetisch identische Tochterzellen. Zuerst verdichten sich in der [[Prophase|Vorphase]] die Chromosomen. In der Metaphase ordnen sie sich in der [[Äquatorialebene]] an.\\n\\nAnschließend trennt der [[Spindelapparat]] die Schwesterchromatiden, bevor sich in der Telophase neue [[Kernhüllen]] bilden.",
  "distractors": ["Meiose", "Interphase", "Zellmembran", "Zentromer", "Polebene"]
}
\`\`\``,
    SELF_CHECK([
      `Sind es ${hasMats ? `höchstens ${s.count}` : `genau ${s.count}`} Lücken, jede mit [[…]] markiert und gleichmäßig verteilt?`,
      'Ist jede Lücke aus dem Zusammenhang eindeutig, und verrät die Grammatik nichts?',
      'Liegt keine Lücke auf einem Füllwort oder Artikel?',
      'Passt kein Ablenkwort richtig in eine Lücke, und haben alle dieselbe Wortart/Form wie die Lösungen?',
      'Ist das JSON gültig (Zeilenumbrüche als \\n, Backslashes in Formeln verdoppelt)?',
    ]),
    materialsBlock(mats),
    finalReminder([
      ...JSON_REMINDER,
      `${hasMats ? `Bis zu ${s.count}` : `Genau ${s.count}`} Lücken als [[…]] im Text, 4–8 Ablenkwörter, Sprache: ${LANGUAGE[s.language]}.`,
    ]),
  ]);
}

const DOC_STYLE_NAME: Record<AiSettings['docStyle'], string> = { summary: 'Zusammenfassung', sheet: 'Lernzettel', explain: 'Erklärung', outline: 'Lern-Checkliste' };

function docPrompt(s: AiSettings, mats: Material[]): string {
  const style = {
    summary: 'eine Zusammenfassung: das Wichtigste in eigenen, klaren Worten, nach Themen gegliedert, mit allen zentralen Definitionen, Aussagen und Zusammenhängen.',
    sheet: 'einen Lernzettel: kompakt und stichpunktartig zum schnellen Wiederholen vor der Prüfung – alle Definitionen, Formeln, Sätze, Merkregeln und typischen Fehler, aber keine langen Erklärungen.',
    explain: 'eine verständliche Erklärung für jemanden, der das Thema zum ersten Mal sieht: Schritt für Schritt, mit Motivation („Wozu braucht man das?“), Beispielen und Zwischenschritten.',
    outline: 'eine Lern-Checkliste: alle Themen und Fähigkeiten als abhakbare Punkte („- [ ] …“), gegliedert nach Kapiteln, jeweils mit einem kurzen Hinweis, was man dazu können muss.',
  }[s.docStyle];
  const words = { short: 'etwa 300–500 Wörter', medium: 'etwa 800–1200 Wörter', long: 'etwa 1500–2500 Wörter' }[s.length];
  return join([
    INTRO('ein Text-Dokument'),
    settingsBlock(s, mats, [`- Schreibe ${style}`, `- Länge: ${words}.`]),
    sources(s, mats),
    `## Aufbau und erlaubte Formatierung (Markdown)
- Die allererste Zeile ist der Titel: "# Titel" (genau einmal, nur dort).
- Die zweite Zeile ist eine kurze Beschreibung: "Beschreibung: …" (ein Satz, höchstens 150 Zeichen, worum es geht). Lass die Beschreibung nur weg, wenn ich in meinen Wünschen ausdrücklich keine möchte.
- Danach eine Leerzeile und der eigentliche Text.
- Abschnitte mit "## Überschrift", Unterabschnitte mit "### Überschrift" – keine tieferen Ebenen.
- Absätze durch eine Leerzeile trennen.
- Aufzählungen mit "- ", nummerierte Listen mit "1. ", Unterpunkte mit 2 Leerzeichen Einrückung.
- Checklisten mit "- [ ] ".
- **fett** für wichtige Begriffe beim ersten Auftreten, *kursiv* sparsam, ==markiert== nur für die allerwichtigsten Merksätze.
- "> " für Definitionen, Sätze oder Merksätze, die hervorgehoben werden sollen.
- \`Code\` und Codeblöcke nur für echten Programmcode.
- "---" als Trennlinie, falls nötig.
- Tabellen (Markdown) NUR für echte Gegenüberstellungen – z. B. Vokabeln (Deutsch | Englisch), Begriff | Bedeutung, Vergleich zweier Verfahren.
  In der App werden sie zu Spalten und Zeilen. Regeln:
  - Höchstens 4 Spalten. Jede Zeile beginnt und endet mit "|", erste Zeile = Kopfzeile, darunter "| --- | --- |".
  - Jede Zelle ist kurz (ein Wort bis ein Satz). Keine Listen, Überschriften oder Absätze in Zellen; Formeln in $…$ sind erlaubt.
  - Ein senkrechter Strich im Text einer Zelle wird als "\\|" geschrieben.
  - Fließtext, Erklärungen und Aufzählungen gehören NICHT in Tabellen.
- NICHT erlaubt: HTML, Bilder, Fußnoten, Links (außer sie stehen im Material), Emojis.`,
    MATH_TEXT,
    `## Antwortformat (exakt einhalten)
- Schreibe das ganze Dokument in genau einen Codeblock, der mit \`\`\`\`markdown (vier Backticks) beginnt und mit \`\`\`\` (vier Backticks) endet – so bleibt der Text beim Kopieren unverändert.
- Vor und nach dem Codeblock steht nichts – keine Einleitung, keine Erklärung, keine Rückfrage.
- Im Codeblock: erste Zeile "# Titel", zweite Zeile "Beschreibung: …", dann eine Leerzeile.`,
    SELF_CHECK([
      'Ist alles fachlich korrekt und vollständig, ohne Erfundenes?',
      `Passen die Länge (${words}) und die Art (${DOC_STYLE_NAME[s.docStyle]})?`,
      'Nur erlaubte Formatierung (kein HTML; Tabellen nur für Gegenüberstellungen und mit höchstens 4 Spalten)?',
    ]),
    materialsBlock(mats),
    finalReminder([
      'Nur ein einziger Codeblock mit vier Backticks (````markdown … ````), nichts davor und nichts danach.',
      'Erste Zeile "# Titel", zweite Zeile "Beschreibung: …", dann "##"-Abschnitte.',
      'Kein HTML. Tabellen nur für Gegenüberstellungen, höchstens 4 Spalten. Formeln in $…$.',
      `Sprache: ${LANGUAGE[s.language]}.`,
    ]),
  ]);
}

function notePrompt(s: AiSettings, mats: Material[]): string {
  const style = s.noteStyle === 'bullets' ? 'Stichpunkte: eine Information pro Zeile, jede Zeile beginnt mit "- ".' : 'kurzer, gut lesbarer Fließtext in wenigen Absätzen.';
  const words = { short: 'etwa 80–150 Wörter', medium: 'etwa 200–350 Wörter', long: 'etwa 400–700 Wörter' }[s.length];
  return join([
    INTRO('eine kurze Notiz (reiner Text)'),
    settingsBlock(s, mats, [`- Form: ${style}`, `- Länge: ${words}.`, '- Nur das Wichtigste – eine Notiz ist zum schnellen Nachlesen gedacht.']),
    sources(s, mats),
    `## Regeln
- Reiner Text: keine Markdown-Formatierung (keine #-Überschriften, kein **fett**, keine Tabellen), kein HTML.
- Formeln in einfacher, lesbarer Schreibweise, z. B. a^2 + b^2 = c^2 oder f'(x) = 3x^2.
- Fachlich korrekt, nichts erfinden.`,
    `## Antwortformat (exakt einhalten)
- Antworte mit genau einem Codeblock, der mit \`\`\`text beginnt und mit \`\`\` endet. Nichts davor und nichts danach.
- Erste Zeile im Codeblock: "Titel: " und ein kurzer Titel (höchstens 60 Zeichen).
- Zweite Zeile: "Beschreibung: " und ein Satz, worum es geht (höchstens 150 Zeichen). Lass die Beschreibung nur weg, wenn ich in meinen Wünschen ausdrücklich keine möchte.
- Dann eine Leerzeile, dann die Notiz.

## Beispiel (nur zur Veranschaulichung des Formats – nicht übernehmen)
\`\`\`text
Titel: Ableitungsregeln
Beschreibung: Die drei wichtigsten Ableitungsregeln zum schnellen Nachschlagen

- Potenzregel: (x^n)' = n·x^(n-1)
- Produktregel: (f·g)' = f'·g + f·g'
- Kettenregel: (f(g(x)))' = f'(g(x))·g'(x)
\`\`\``,
    materialsBlock(mats),
    finalReminder(['Nur ein einziger ```text-Codeblock, erste Zeile "Titel: …", zweite Zeile "Beschreibung: …".', `Sprache: ${LANGUAGE[s.language]}.`]),
  ]);
}

export function buildPrompt(s: AiSettings, mats: Material[]): string {
  const ready = mats.filter((m) => m.status === 'ready');
  switch (s.kind) {
    case 'cards':
      return cardsPrompt(s, ready);
    case 'quiz':
      return quizPrompt(s, ready);
    case 'chart':
      return chartPrompt(s, ready);
    case 'wheel':
      return wheelPrompt(s, ready);
    case 'gaps':
      return gapsPrompt(s, ready);
    case 'doc':
      return docPrompt(s, ready);
    case 'note':
      return notePrompt(s, ready);
  }
}

// ---------- Antwort einlesen ----------

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');
const pick = (o: Obj, ...keys: string[]) => {
  for (const k of keys) if (o[k] !== undefined) return o[k];
  return undefined;
};
const listOf = (o: Obj, ...keys: string[]): unknown[] => {
  const v = pick(o, ...keys);
  if (Array.isArray(v)) return v;
  // Notfalls die erste Liste im Objekt
  const first = Object.values(o).find(Array.isArray);
  return (first as unknown[] | undefined) ?? [];
};
const titleOf = (o: Obj) => str(pick(o, 'title', 'titel', 'name')).trim().slice(0, 120);

/** Hat die KI (oder der Nutzer beim Einfügen) vielleicht etwas ganz anderes geliefert? */
function wrongKind(o: Obj, kind: AiKind): string | null {
  const has = (k: string) => Array.isArray(o[k]);
  const found: [AiKind, boolean][] = [
    ['cards', has('cards')],
    ['quiz', has('questions')],
    ['chart', has('points')],
    ['wheel', has('entries')],
    ['gaps', typeof o.text === 'string' && o.text.includes('[[')],
  ];
  const other = found.find(([k, h]) => h && k !== kind);
  if (other && !found.some(([k, h]) => h && k === kind)) return `Das sieht nach „${kindInfo(other[0]).label}“ aus, nicht nach „${kindInfo(kind).label}“. Hast du oben die richtige Art gewählt?`;
  return null;
}

function countWarning(got: number, wanted: number, noun: string, plural: string, exact: boolean): string | null {
  if (got === wanted || (!exact && got < wanted && got > 0)) return null;
  return `Du wolltest ${wanted} ${plural}, die KI hat ${got} ${got === 1 ? noun : plural} geliefert.`;
}

/** Name mit „(KI)“ am Ende, damit man sieht, was von einer KI stammt (lässt sich im Editor ändern). */
export const KI_SUFFIX = ' (KI)';
export function withKi(title: string, fallback: string): string {
  const t = (title.trim() || fallback).replace(/\s*\((KI|AI)\)\s*$/i, '').slice(0, 120 - KI_SUFFIX.length).trim();
  return `${t}${KI_SUFFIX}`;
}

/** „Beschreibung: …“ aus der ersten Zeile holen (Text-Dokument und Notiz). */
function takeDescription(text: string): { description: string; rest: string } {
  const m = text.match(/^\s*(?:>\s*)?\*{0,2}Beschreibung\*{0,2}\s*:\s*(.*)(\n|$)/i);
  if (!m) return { description: '', rest: text };
  return { description: m[1].replace(/[*_]/g, '').trim().slice(0, 500), rest: text.slice(m[0].length) };
}

export function parseAnswer(answer: string, s: AiSettings): Parsed {
  const p = parseRaw(answer, s);
  p.result.title = withKi(p.result.title, kindInfo(s.kind).label);
  if (p.result.description) p.result.description = p.result.description.trim().slice(0, 500);
  return p;
}

function parseRaw(answer: string, s: AiSettings): Parsed {
  const kind = s.kind;
  if (!answer.trim()) throw new Error('Füge zuerst die Antwort der KI ein.');

  if (kind === 'doc') {
    const md = unfence(answer);
    if (/^\s*\{[\s\S]*"(cards|questions|points|entries)"/.test(md)) throw new Error('Das ist JSON, kein Text-Dokument. Hast du oben die richtige Art gewählt?');
    const { title, body: withDesc } = splitTitle(md);
    const { description, rest: body } = takeDescription(withDesc);
    const html = markdownToHtml(body);
    if (!html.replace(/<[^>]+>/g, '').trim() && !html.includes('class="math"')) throw new Error('In der Antwort steht kein Text.');
    const sections = (body.match(/^##\s/gm) ?? []).length;
    const warnings: string[] = [];
    if (!title) warnings.push('Die KI hat keinen Titel („# …“) mitgeschickt – gib dem Dokument im Editor einen Namen.');
    if (/<\/?(div|table|span|p|br)\b/i.test(body.replace(/^\s*\|.*\|\s*$/gm, ''))) warnings.push('Die KI hat HTML verwendet – das wird nur teilweise übernommen.');
    return { result: { kind, title, html, description }, summary: `Text-Dokument${title ? ` „${title}“` : ''} mit ${sections} ${sections === 1 ? 'Abschnitt' : 'Abschnitten'} erkannt`, warnings };
  }

  if (kind === 'note') {
    let t = unfence(answer).trim();
    let title = '';
    const m = t.match(/^\s*Titel\s*:\s*(.+)(\n|$)/i);
    if (m) {
      title = m[1].trim().slice(0, 120);
      t = t.slice(m[0].length);
    }
    const d = takeDescription(t);
    t = d.rest.trim();
    if (!t) throw new Error('In der Antwort steht kein Text.');
    return { result: { kind, title, text: t, description: d.description }, summary: `Notiz${title ? ` „${title}“` : ''} erkannt (${t.length.toLocaleString('de')} Zeichen)`, warnings: [] };
  }

  const o = extractJson(answer);
  const description = str(pick(o, 'description', 'beschreibung')).trim();
  const wrong = wrongKind(o, kind);
  if (wrong) throw new Error(wrong);
  const warnings: string[] = [];

  if (kind === 'cards') {
    const raw = listOf(o, 'cards', 'karten', 'flashcards').filter(isObj);
    const cards = parseCards(
      JSON.stringify({
        cards: raw.map((c) => ({
          front: str(pick(c, 'front', 'vorderseite', 'question', 'frage', 'term', 'begriff')),
          back: str(pick(c, 'back', 'rückseite', 'rueckseite', 'answer', 'antwort', 'definition')),
        })),
      }),
    ).cards.filter((c) => c.front.trim() || c.back.trim());
    if (!cards.length) throw new Error('Keine Karteikarten gefunden. Steht in der Antwort eine Liste "cards" mit "front" und "back"?');
    const half = cards.filter((c) => !c.front.trim() || !c.back.trim()).length;
    if (half) warnings.push(`${half} ${half === 1 ? 'Karte hat' : 'Karten haben'} eine leere Seite.`);
    const cw = countWarning(cards.length, s.count, 'Karte', 'Karten', false);
    if (cw) warnings.push(cw);
    return { result: { kind, title: titleOf(o), cards, description }, summary: `${cards.length} ${cards.length === 1 ? 'Karte' : 'Karten'} erkannt`, warnings };
  }

  if (kind === 'quiz') {
    const raw = listOf(o, 'questions', 'fragen').filter(isObj);
    const normalized = raw.map((q) => {
      const answersRaw = listOf(q, 'answers', 'antworten', 'options', 'choices');
      const correctIdx = pick(q, 'correct', 'correctIndex', 'richtig');
      const idxs = new Set((Array.isArray(correctIdx) ? correctIdx : [correctIdx]).filter((v): v is number => typeof v === 'number'));
      return {
        text: str(pick(q, 'text', 'question', 'frage')),
        explanation: str(pick(q, 'explanation', 'erklärung', 'erklaerung')),
        answers: answersRaw.map((a, i) => {
          if (!isObj(a)) return { text: str(a), correct: idxs.has(i) };
          const c = pick(a, 'correct', 'richtig');
          return { text: str(pick(a, 'text', 'antwort', 'answer')), correct: c === true || c === 'true' };
        }),
      };
    });
    const questions = parseQuiz(JSON.stringify({ questions: normalized })).questions.filter((q) => q.text.trim());
    if (!questions.length) throw new Error('Keine Quizfragen gefunden. Steht in der Antwort eine Liste "questions" mit "text" und "answers"?');
    const noRight = questions.filter((q) => !q.answers.some((a) => a.correct)).length;
    const few = questions.filter((q) => q.answers.filter((a) => a.text.trim()).length < 2).length;
    if (noRight) warnings.push(`${noRight} ${noRight === 1 ? 'Frage hat' : 'Fragen haben'} keine richtige Antwort – bitte im Editor markieren.`);
    if (few) warnings.push(`${few} ${few === 1 ? 'Frage hat' : 'Fragen haben'} weniger als zwei Antworten.`);
    if (!s.multi) {
      const multi = questions.filter((q) => q.answers.filter((a) => a.correct).length > 1).length;
      if (multi) warnings.push(`${multi} ${multi === 1 ? 'Frage hat' : 'Fragen haben'} mehrere richtige Antworten, obwohl nur eine richtig sein sollte.`);
    }
    const cw = countWarning(questions.length, s.count, 'Frage', 'Fragen', false);
    if (cw) warnings.push(cw);
    return { result: { kind, title: titleOf(o), questions, description }, summary: `${questions.length} ${questions.length === 1 ? 'Frage' : 'Fragen'} erkannt`, warnings };
  }

  if (kind === 'chart') {
    const pts = listOf(o, 'points', 'data', 'daten', 'werte').map((p) => {
      if (!isObj(p)) return p;
      let v = pick(p, 'value', 'wert', 'y');
      if (typeof v === 'string') {
        // "12,5" · "1.234,5" · "1,234.5" – das letzte Trennzeichen ist das Dezimalzeichen.
        const t = v.replace(/[^\d,.-]/g, '');
        const dec = Math.max(t.lastIndexOf(','), t.lastIndexOf('.'));
        v = dec < 0 ? t : `${t.slice(0, dec).replace(/[.,]/g, '')}.${t.slice(dec + 1)}`;
      }
      return { label: str(pick(p, 'label', 'name', 'x', 'beschriftung')), value: v };
    });
    const chart = parseChart({ ...o, chart: str(pick(o, 'chart', 'type', 'typ')).toLowerCase(), points: pts });
    chart.points = chart.points.filter((p) => p.label.trim() || p.value !== 0);
    if (!chart.points.length) throw new Error('Keine Datenpunkte gefunden. Steht in der Antwort eine Liste "points" mit "label" und "value"?');
    if (s.chartType !== 'auto' && chart.chart !== s.chartType) warnings.push('Die KI hat einen anderen Diagrammtyp gewählt – du kannst ihn im Editor ändern.');
    if (/beispiel/i.test(chart.title)) warnings.push('Die KI hat Beispielwerte verwendet (keine echten Daten).');
    return { result: { kind, title: chart.title, chart, description }, summary: `Diagramm mit ${chart.points.length} ${chart.points.length === 1 ? 'Wert' : 'Werten'} erkannt`, warnings };
  }

  if (kind === 'gaps') {
    const rawText = str(pick(o, 'text', 'lückentext', 'lueckentext'));
    const distractorsRaw = listOf(o, 'distractors', 'ablenkwörter', 'ablenkwoerter').map((d) => str(d).trim()).filter(Boolean);
    const doc = parseGapsDoc({ text: rawText, distractors: distractorsRaw, mode: 'drag', typos: true });
    const gaps = gapsOf(doc.text);
    if (!doc.text.trim()) throw new Error('Kein Text gefunden. Steht in der Antwort ein Feld "text" mit dem Lückentext?');
    if (!gaps.length) throw new Error('Im Text sind keine Lücken markiert. Die Lücken müssen in doppelten eckigen Klammern stehen, z. B. [[Mitose]].');
    // Ablenkwörter, die eigentlich eine richtige Lösung sind, wären unfair
    const answers = new Set(gaps.flatMap((g) => g.answers.map((a) => a.toLowerCase())));
    const clash = doc.distractors.filter((d) => answers.has(d.toLowerCase()));
    if (clash.length) {
      doc.distractors = doc.distractors.filter((d) => !answers.has(d.toLowerCase()));
      warnings.push(`${clash.length} Ablenkwort${clash.length === 1 ? ' war' : 'wörter waren'} eine richtige Lösung und wurde${clash.length === 1 ? '' : 'n'} entfernt.`);
    }
    if (!doc.distractors.length) warnings.push('Die KI hat keine Ablenkwörter geliefert – du kannst im Editor welche ergänzen.');
    const cw = countWarning(gaps.length, s.count, 'Lücke', 'Lücken', false);
    if (cw) warnings.push(cw);
    return {
      result: { kind, title: titleOf(o), doc, description },
      summary: `Lückentext mit ${gaps.length} ${gaps.length === 1 ? 'Lücke' : 'Lücken'} und ${doc.distractors.length} Ablenkwörtern erkannt`,
      warnings,
    };
  }

  // Glücksrad
  const entries = listOf(o, 'entries', 'einträge', 'eintraege', 'items').map((e) =>
    isObj(e) ? { label: str(pick(e, 'label', 'text', 'name')), weight: pick(e, 'weight', 'gewicht') } : { label: str(e), weight: 1 },
  );
  const wheel = parseWheel({ ...o, entries });
  wheel.entries = wheel.entries.filter((e) => e.label.trim());
  if (!wheel.entries.length) throw new Error('Keine Einträge gefunden. Steht in der Antwort eine Liste "entries" mit "label"?');
  const long = wheel.entries.filter((e) => e.label.length > 40).length;
  if (long) warnings.push(`${long} ${long === 1 ? 'Eintrag ist' : 'Einträge sind'} recht lang und passen evtl. schlecht ins Rad.`);
  const cw = countWarning(wheel.entries.length, s.count, 'Eintrag', 'Einträge', true);
  if (cw) warnings.push(cw);
  return { result: { kind, title: wheel.title, wheel, description }, summary: `${wheel.entries.length} ${wheel.entries.length === 1 ? 'Eintrag' : 'Einträge'} erkannt`, warnings };
}
