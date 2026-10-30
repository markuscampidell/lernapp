import { useMemo, useRef, useState } from 'react';
import type { FileItem } from '../../domain/types';
import { TextLine } from '../../components/TextLine';
import { Icon } from '../../components/Icon';
import { Pager, StudyScreen } from './StudyScreen';
import { CARDS_EXT, CARDS_MIME, cardsBlob, newCard, type Card } from './format';
import { useStudySave } from './useStudySave';
import { DetailsButton } from './DetailsButton';
import { MathPreview } from '../../components/MathText';

/** Karteikarten anlegen/bearbeiten: eine Karte pro Seite (Vorder- und Rückseite). */
export function CardsEditor({ file, folderId, initial, onClose }: { file?: FileItem; folderId?: string; initial?: Card[]; onClose: () => void }) {
  const [name, setName] = useState(file?.name ?? '');
  const [cards, setCards] = useState<Card[]>(() => (initial?.length ? initial : [newCard()]));
  const [index, setIndex] = useState(0);
  const start = useRef(JSON.stringify({ name, cards }));
  const { save, busy, err, setErr } = useStudySave({ file, folderId, ext: CARDS_EXT, mime: CARDS_MIME });
  const frontRef = useRef<HTMLTextAreaElement>(null);

  const card = cards[Math.min(index, cards.length - 1)];
  const filled = useMemo(() => cards.filter((c) => c.front.trim() || c.back.trim()).length, [cards]);
  const dirty = JSON.stringify({ name, cards }) !== start.current;

  const update = (patch: Partial<Card>) => setCards((prev) => prev.map((c) => (c.id === card.id ? { ...c, ...patch } : c)));
  const go = (i: number) => {
    setIndex(i);
    setTimeout(() => frontRef.current?.focus(), 0);
  };
  const add = () => {
    setCards((prev) => [...prev.slice(0, index + 1), newCard(), ...prev.slice(index + 1)]);
    go(index + 1);
  };
  const remove = () => {
    if ((card.front.trim() || card.back.trim()) && !confirm('Diese Karte löschen?')) return;
    if (cards.length === 1) setCards([newCard()]);
    else {
      setCards((prev) => prev.filter((c) => c.id !== card.id));
      setIndex(Math.max(0, index - (index === cards.length - 1 ? 1 : 0)));
    }
  };
  const close = () => {
    if (dirty && !busy && !confirm('Änderungen verwerfen?')) return;
    onClose();
  };
  const submit = async () => {
    if (!name.trim()) return setErr('Gib den Karteikarten einen Namen.');
    if (filled === 0) return setErr('Füge mindestens eine Karte hinzu.');
    if (await save(name, cardsBlob(cards))) onClose();
  };

  return (
    <StudyScreen
      editing={file}
      title={file ? 'Karteikarten bearbeiten' : 'Neue Karteikarten'}
      subtitle={`${filled} ${filled === 1 ? 'Karte' : 'Karten'}`}
      onClose={close}
      actions={
        <>
          {file && <DetailsButton file={file} onRenamed={setName} onDeleted={onClose} />}
          <button className="btn primary small" onClick={submit} disabled={busy}>
            {busy ? 'Speichert …' : 'Speichern'}
          </button>
        </>
      }
    >
      <div className="study-form">
        <div className="field">
          <div className="field-label">
            <span>Name</span>
          </div>
          <TextLine autoFocus={!file} value={name} onChange={setName} placeholder="z. B. Vokabeln Kapitel 1" maxLength={120} enterKeyHint="next" onEnter={() => frontRef.current?.focus()} />
        </div>

        <Pager index={index} count={cards.length} noun="Karte" onIndex={go} />

        <div className="card edit-card">
          <label className="field">
            <span className="field-label">Vorderseite</span>
            <textarea ref={frontRef} rows={4} value={card.front} onChange={(e) => update({ front: e.target.value })} placeholder="Begriff oder Frage" />
            <MathPreview text={card.front} />
          </label>
          <label className="field">
            <span className="field-label">Rückseite</span>
            <textarea rows={4} value={card.back} onChange={(e) => update({ back: e.target.value })} placeholder="Erklärung oder Antwort" />
            <MathPreview text={card.back} />
          </label>
        <p className="muted small math-hint">Formeln: <code>$x^2$</code> im Text, <code>$$\int_0^1 x\,dx$$</code> in eigener Zeile.</p>
        </div>

        <div className="input-row">
          <button className="btn ghost danger" onClick={remove}>
            <Icon name="trash" size={18} /> Karte löschen
          </button>
          <button className="btn primary grow" onClick={add}>
            <Icon name="plus" size={18} /> Neue Karte
          </button>
        </div>
        {err && <p className="notice critical">{err}</p>}
      </div>
    </StudyScreen>
  );
}
