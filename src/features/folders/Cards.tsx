import type { ReactNode } from 'react';
import type { FileItem, Folder } from '../../domain/types';
import { counts, plural } from '../../domain/tree';
import { useLibrary } from '../../state/Library';
import { FileThumb, FolderThumb } from '../../components/Thumbs';
import { Icon } from '../../components/Icon';
import { useLongPress } from '../../hooks/useLongPress';
import { fileKind, formatSize, fullName, KIND_LABEL } from '../../lib/files';

export interface ItemCardProps {
  onClick: () => void;
  /** ✏️ Inhalt bearbeiten (nur Karteikarten/Quiz/Dokumente und nur wenn erlaubt). */
  onEdit?: () => void;
  /** ⓘ Details: Name, Beschreibung, Ort, Rechte, Löschen. */
  onInfo?: () => void;
  /** Langes Drücken (startet den Auswahlmodus, nur auf Touch-Geräten). */
  onLongPress?: () => void;
  selecting?: boolean;
  selected?: boolean;
  path?: string;
  /** Seit dem letzten Öffnen des Ordners von jemand anderem hinzugefügt/geändert. */
  isNew?: boolean;
}

function ItemCard({ onClick, onEdit, onInfo, onLongPress, selecting, selected, thumb, children, label }: ItemCardProps & { thumb: ReactNode; children: ReactNode; label: string }) {
  const press = useLongPress(onLongPress);
  return (
    <div className={`card item-card${selecting ? ' selecting' : ''}${selected ? ' selected' : ''}`}>
      <button className="item-main" onClick={onClick} {...press} aria-pressed={selecting ? !!selected : undefined}>
        {thumb}
        <div className="card-main">{children}</div>
        {selecting && (
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
  return <span className="chip by-chip">von {id && id === me?.id ? 'dir' : userName(id)}</span>;
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
      <FolderThumb folder={folder} />
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
    <ItemCard {...rest} thumb={thumb} label={folder.name}>
      <strong className="ellipsis">{folder.name}</strong>
      {path && <span className="muted small ellipsis">{path}</span>}
      {folder.description && <span className="muted small clamp-2">{folder.description}</span>}
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
  return (
    <ItemCard {...rest} thumb={<FileThumb file={file} />} label={fullName(file)}>
      <strong className="ellipsis">{fullName(file)}</strong>
      {path && <span className="muted small ellipsis">{path}</span>}
      {file.description && <span className="muted small clamp-2">{file.description}</span>}
      <span className="chips">
        {isNew && <span className="chip new-chip">Neu</span>}
        <span className={`chip kind-chip kind-${kind}`}>{KIND_LABEL[kind]}</span>
        <span className="chip">{formatSize(file.size)}</span>
        {file.shareId && <ByChip id={file.createdBy} />}
        {file.shareId && <AccessChip item={file} />}
      </span>
    </ItemCard>
  );
}
