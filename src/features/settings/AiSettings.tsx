import { AI_PROXY_URL } from '../../ai/config';

/** Hinweise zur KI (Google Gemini über den Lernapp-Server). */
export function AiSettings() {
  return (
    <div className="card stack">
      <p className="muted small">
        Die KI nutzt <strong>Google Gemini</strong> und ist für dich kostenlos – ohne Konto und ohne eigenen Schlüssel. Wenn du
        eine Frage stellst oder ein Quiz erstellst, wird der Text der gewählten Unterlagen an Google gesendet. Alle anderen
        Dateien bleiben nur auf diesem Gerät.
      </p>
      {!AI_PROXY_URL && <p className="notice warning">Die KI ist noch nicht eingerichtet (Server-Adresse fehlt).</p>}
      <p className="muted small">
        Hinweis: Auch die KI kann Fehler machen. Prüfe wichtige Antworten über die angegebene Quelle. Bilder und eingescannte
        Seiten kann sie noch nicht lesen. Die KI braucht eine Internetverbindung.
      </p>
    </div>
  );
}
