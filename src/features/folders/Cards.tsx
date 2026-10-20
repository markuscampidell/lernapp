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

export function FolderCard({ folder, path, ...rest }: ItemCardProps & { folder: Folder }) {
  const { folders, files } = useLibrary();
  const c = counts(folders, files, folder.id);
  const parts = [c.folders > 0 && plural(c.folders, 'Unterordner', 'Unterordner'), c.files > 0 && plural(c.files, 'Datei', 'Dateien')].filter(Boolean);
  return (
    <ItemCard {...rest} thumb={<FolderThumb folder={folder} />} deleteLabel={`„${folder.name}“ löschen`}>
      <strong className="ellipsis">{folder.name}</strong>
      {path && <span className="muted small ellipsis">{path}</span>}
      {folder.description && <span className="muted small clamp-2">{folder.description}</span>}
      <span className="muted small">{parts.length ? parts.join(' · ') : 'Leer'}</span>
    </ItemCard>
  );
}

export function FileCard({ file, path, ...rest }: ItemCardProps & { file: FileItem }) {
  const kind = fileKind(file);
  return (
    <ItemCard {...rest} thumb={<FileThumb file={file} />} deleteLabel={`„${fullName(file)}“ löschen`}>
      <strong className="ellipsis">{fullName(file)}</strong>
      {path && <span className="muted small ellipsis">{path}</span>}
      {file.description && <span className="muted small clamp-2">{file.description}</span>}
      <span className="chips">
        <span className={`chip kind-chip kind-${kind}`}>{KIND_LABEL[kind]}</span>
        <span className="chip">{formatSize(file.size)}</span>
      </span>
    </ItemCard>
  );
}
