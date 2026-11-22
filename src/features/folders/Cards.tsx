import type { ReactNode } from 'react';
import type { FileItem, Folder } from '../../domain/types';
import { counts, plural } from '../../domain/tree';
import { useLibrary } from '../../state/Library';
import { FileThumb, FolderThumb } from '../../components/Thumbs';
import { Icon } from '../../components/Icon';
import { Avatar } from '../../components/Avatar';
import { describe } from '../changes/diff';
import { useLongPress } from '../../hooks/useLongPress';
import { fileKind, formatSize, KIND_LABEL, shownName } from '../../lib/files';

export interface ItemCardProps {
  onClick: () => void;
  /** ✏️ Inhalt bearbeiten (nur Karteikarten/Quiz/Dokumente und nur wenn erlaubt). */
  onEdit?: () => void;
  /** ⓘ Details: Name, Beschreibung, Ort, Rechte, Löschen. */
  onInfo?: () => void;
  /** Personen (wer es sieht, teilen, Rechte). */
  onPeople?: () => void;
  /** Verschieben (nur wenn erlaubt). */
  onMove?: () => void;
  /** Langes Drücken – mit Finger oder gedrückter Maustaste (startet den Auswahlmodus). */
  onLongPress?: () => void;
  selecting?: boolean;
  selected?: boolean;
  /** Im Auswahlmodus nicht wählbar (z. B. geteilter Ordner, während eigene ausgewählt sind). */
  blocked?: boolean;
  path?: string;
  /** Seit dem letzten Öffnen des Ordners von jemand anderem hinzugefügt/geändert. */
  isNew?: boolean;
  /** Gerade geschlossen: kurz umrahmen. */
  flash?: boolean;
}

function ItemCard({ onClick, onEdit, onInfo, onPeople, onMove, onLongPress, selecting, selected, blocked, flash, thumb, children, label, chevron }: ItemCardProps & { thumb: ReactNode; children: ReactNode; label: string; chevron?: boolean }) {
  const press = useLongPress(onLongPress);
  // Steht der Cursor im Suchfeld, bleibt er dort, wenn man etwas auswählt (Antippen im Auswahlmodus, langes Drücken).
  // Öffnet man dagegen einen Ordner/eine Datei, wird das Suchfeld verlassen (sonst bliebe die Tastatur offen).
  const searchFocused = () => !!(document.activeElement instanceof HTMLElement && document.activeElement.closest('.search'));
  const keepSearch = (e: React.MouseEvent) => {
    if (searchFocused()) e.preventDefault();
  };
  const click = () => {
    if (!selecting && searchFocused()) (document.activeElement as HTMLElement).blur();
    onClick?.();
  };
  return (
    <div className={`card item-card${selecting ? ' selecting' : ''}${selected ? ' selected' : ''}${selecting && blocked ? ' blocked' : ''}${flash ? ' flash' : ''}`}>
      <button className="item-main" onClick={click} onMouseDown={keepSearch} {...press} disabled={selecting && blocked} aria-pressed={selecting ? !!selected : undefined}>
        {thumb}
        <div className="card-main">{children}</div>
        {chevron && !selecting && !onEdit && !onInfo && !onMove && !onPeople && (
          <span className="item-chevron" aria-hidden="true">
            <Icon name="chevron" size={18} />
          </span>
        )}
        {selecting && !blocked && (
          <span className={`tick${selected ? ' on' : ''}`} aria-hidden="true">
            {selected && <Icon name="check" size={16} />}
          </span>
        )}
      </button>
      {!selecting && onEdit && (
        <button className="icon-btn item-action item-edit" aria-label={`„${label}“ bearbeiten`} title="Bearbeiten" onClick={onEdit}>
          <Icon name="edit" size={19} />
        </button>
      )}
      {!selecting && onPeople && (
        <button className="icon-btn item-action item-people" aria-label={`Personen von „${label}“`} title="Personen" onClick={onPeople}>
          <Icon name="users" size={19} />
        </button>
      )}
      {!selecting && onMove && (
        <button className="icon-btn item-action item-move" aria-label={`„${label}“ verschieben`} title="Verschieben" onClick={onMove}>
          <Icon name="move" size={19} />
        </button>
      )}
      {!selecting && onInfo && (
        <button className="icon-btn item-action item-info" aria-label={`Details zu „${label}“`} title="Details" onClick={onInfo}>
          <Icon name="info" size={19} />
        </button>
      )}
    </div>
  );
}

/** "von Anna" bei geteilten Einträgen. */
function ByChip({ id }: { id: string | null | undefined }) {
  const { me, userName } = useLibrary();
  return (
    <span className="chip by-chip">
      <Avatar id={id} size="sm" /> von {id && id === me?.id ? 'dir' : userName(id)}
    </span>
  );
}

/** Zeigt, wenn andere mehr als nur lesen dürfen. */
function AccessChip({ item }: { item: Folder | FileItem }) {
  const { accessOf } = useLibrary();
  const a = accessOf(item);
  if (a === 'read') return null;
  return (
    <span className="chip access-chip" title={a === 'delete' ? 'Alle dürfen bearbeiten und löschen' : 'Alle dürfen bearbeiten'}>
      <Icon name={a === 'delete' ? 'trash' : 'edit'} size={12} /> {a === 'delete' ? 'alle: löschen' : 'alle: bearbeiten'}
    </span>
  );
}

export function FolderCard({ folder, path, isNew, ...rest }: ItemCardProps & { folder: Folder }) {
  const { folders, files, unread, isRoot, shareOf, me, userName, isOrphan, peopleOf } = useLibrary();
  const c = counts(folders, files, folder.id);
  const parts = [c.folders > 0 && plural(c.folders, 'Unterordner', 'Unterordner'), c.files > 0 && plural(c.files, 'Datei', 'Dateien')].filter(Boolean);
  const root = isRoot(folder);
  const share = root ? shareOf(folder) : undefined;
  const thumb = (
    <span className="thumb-wrap">
      <FolderThumb folder={folder} expand={!rest.selecting} />
      {/* Eigene Ordner, die nur auf meinen Geräten liegen (mit niemandem geteilt), bekommen kein Teilen-Zeichen. */}
      {((root && (share?.ownerId !== me?.id || peopleOf(share?.id).length > 1)) || isOrphan(folder.id)) && (
        <span className="shared-mark" title="Geteilt">
          <Icon name="users" size={12} />
        </span>
      )}
      {unread.has(folder.id) && (
        <span className="unread-dot" title="Neues von anderen">
          !
        </span>
      )}
    </span>
  );
  return (
    <ItemCard {...rest} thumb={thumb} label={folder.name} chevron>
      <strong className="wrap-text">{folder.name}</strong>
      {path && <span className="muted small wrap-text">{path}</span>}
      {folder.description && <span className="muted small wrap-text">{folder.description}</span>}
      <span className="muted small">
        {share && share.ownerId !== me?.id && `Von ${userName(share.ownerId)} geteilt · `}
        {parts.length ? parts.join(' · ') : 'Leer'}
      </span>
      {(isNew || (folder.shareId && !root)) && (
        <span className="chips">
          {isNew && <span className="chip new-chip">Neu</span>}
          {folder.shareId && !root && <ByChip id={folder.createdBy} />}
          {folder.shareId && !root && <AccessChip item={folder} />}
        </span>
      )}
    </ItemCard>
  );
}

export function FileCard({ file, path, isNew, ...rest }: ItemCardProps & { file: FileItem }) {
  const kind = fileKind(file);
  const { commentInfo, changesFor, userName } = useLibrary();
  const comments = commentInfo(file.id);
  const changes = changesFor(file.id);
  return (
    <ItemCard {...rest} thumb={<FileThumb file={file} expand={!rest.selecting} />} label={shownName(file)}>
      <strong className="wrap-text">{shownName(file)}</strong>
      {path && <span className="muted small wrap-text">{path}</span>}
      {file.description && <span className="muted small wrap-text">{file.description}</span>}
      {changes.length > 0 && (
        <span className="change-line small wrap-text">
          <Icon name="edit" size={13} /> {changes.map((c) => `${userName(c.userId)}: ${describe(c.parts)}`).join(' · ')}
        </span>
      )}
      <span className="chips">
        {isNew && <span className="chip new-chip">Neu</span>}
        <span className={`chip kind-chip kind-${kind}`}>{KIND_LABEL[kind]}</span>
        <span className="chip">{formatSize(file.size)}</span>
        {file.shareId && <ByChip id={file.createdBy} />}
        {file.shareId && <AccessChip item={file} />}
        {comments.count > 0 && (
          <span className={`chip comment-chip${comments.unread ? ' unread' : ''}`} title={comments.unread ? 'Neue Kommentare' : 'Kommentare'}>
            <Icon name="comment" size={12} /> {comments.count}
          </span>
        )}
      </span>
    </ItemCard>
  );
}
