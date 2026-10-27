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
  /** Löschen-Knopf rechts (ausgeblendet im Auswahlmodus). */
  onDelete?: () => void;
  /** Verschieben-Knopf rechts (ausgeblendet im Auswahlmodus). */
  onMove?: () => void;
  /** Langes Drücken (startet den Auswahlmodus, nur auf Touch-Geräten). */
  onLongPress?: () => void;
  selecting?: boolean;
  selected?: boolean;
  path?: string;
  /** Seit dem letzten Öffnen des Ordners von jemand anderem hinzugefügt/geändert. */
  isNew?: boolean;
}

function ItemCard({ onClick, onDelete, onMove, onLongPress, selecting, selected, thumb, children, deleteLabel }: ItemCardProps & { thumb: ReactNode; children: ReactNode; deleteLabel: string }) {
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
      {!selecting && onMove && (
        <button className="icon-btn item-action" aria-label="Verschieben" title="Verschieben" onClick={onMove}>
          <Icon name="move" size={19} />
        </button>
      )}
      {!selecting && onDelete && (
        <button className="icon-btn item-delete" aria-label={deleteLabel} title="Löschen" onClick={onDelete}>
          <Icon name="trash" size={19} />
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

export function FolderCard({ folder, path, isNew, ...rest }: ItemCardProps & { folder: Folder }) {
  const { folders, files, unread, isRoot, shareOf, me, userName, isOrphan } = useLibrary();
  const c = counts(folders, files, folder.id);
  const parts = [c.folders > 0 && plural(c.folders, 'Unterordner', 'Unterordner'), c.files > 0 && plural(c.files, 'Datei', 'Dateien')].filter(Boolean);
  const root = isRoot(folder);
  const share = root ? shareOf(folder) : undefined;
  const thumb = (
    <span className="thumb-wrap">
      <FolderThumb folder={folder} />
      {(root || isOrphan(folder.id)) && (
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
    <ItemCard {...rest} thumb={thumb} deleteLabel={`„${folder.name}“ löschen`}>
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
        </span>
      )}
    </ItemCard>
  );
}

export function FileCard({ file, path, isNew, ...rest }: ItemCardProps & { file: FileItem }) {
  const kind = fileKind(file);
  return (
    <ItemCard {...rest} thumb={<FileThumb file={file} />} deleteLabel={`„${fullName(file)}“ löschen`}>
      <strong className="ellipsis">{fullName(file)}</strong>
      {path && <span className="muted small ellipsis">{path}</span>}
      {file.description && <span className="muted small clamp-2">{file.description}</span>}
      <span className="chips">
        {isNew && <span className="chip new-chip">Neu</span>}
        <span className={`chip kind-chip kind-${kind}`}>{KIND_LABEL[kind]}</span>
        <span className="chip">{formatSize(file.size)}</span>
        {file.shareId && <ByChip id={file.createdBy} />}
      </span>
    </ItemCard>
  );
}
