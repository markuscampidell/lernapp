/** Im Editor nach dem Wiederherstellen: „Ungespeicherte Änderungen wiederhergestellt“ – Speichern (oben) oder Verwerfen. */
export function DraftNotice({ onDiscard }: { onDiscard: () => void }) {
  return (
    <div className="notice info draft-notice" role="status">
      <span className="grow">Ungespeicherte Änderungen wiederhergestellt – Speichern oder Verwerfen.</span>
      <button
        className="btn ghost small danger"
        onClick={() => confirm('Deine wiederhergestellten Änderungen verwerfen? Das kann nicht rückgängig gemacht werden.') && onDiscard()}
      >
        Verwerfen
      </button>
    </div>
  );
}
