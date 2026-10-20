import { Icon } from '../../components/Icon';

export function AiView() {
  return (
    <section className="view">
      <header className="view-header">
        <h1>KI</h1>
        <span className="badge">Kommt bald</span>
      </header>
      <div className="card ai-card">
        <span className="ai-icon">
          <Icon name="ai" size={28} />
        </span>
        <h2>Fragen zu deinen Unterlagen</h2>
        <p className="muted">
          Hier wählst du bald eine Datei oder einen ganzen Ordner aus und stellst Fragen dazu. Die KI antwortet
          ausschließlich mit Informationen aus deinen Dateien und zeigt, woher die Antwort stammt. Steht etwas nicht
          in deinen Unterlagen, sagt sie das, statt zu raten.
        </p>
      </div>
      <ul className="list">
        <li className="card">
          <strong>1. Auswählen</strong>
          <p className="muted small">Eine Datei, mehrere Dateien oder einen Ordner samt Unterordnern.</p>
        </li>
        <li className="card">
          <strong>2. Analysieren</strong>
          <p className="muted small">Texte, PDFs und Präsentationen werden gelesen und zusammengefasst.</p>
        </li>
        <li className="card">
          <strong>3. Fragen stellen</strong>
          <p className="muted small">Antworten nur aus deinem Material – mit Quellenangabe.</p>
        </li>
      </ul>
    </section>
  );
}
