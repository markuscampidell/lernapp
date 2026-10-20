import type { FileItem, Folder } from '../../domain/types';
import { counts, plural } from '../../domain/tree';
import { useLibrary } from '../../state/Library';
import { FileThumb, FolderThumb } from '../../components/Thumbs';
import { Icon } from '../../components/Icon';
import { fileKind, formatSize, fullName, KIND_LABEL } from '../../lib/files';

export function FolderCard({ folder, path, onClick }: { folder: Folder; path?: string; onClick: () => void }) {
  const { folders, files } = useLibrary();
  const c = counts(folders, files, folder.id);
  const parts = [c.folders > 0 && plural(c.folders, 'Unterordner', 'Unterordner'), c.files > 0 && plural(c.files, 'Datei', 'Dateien')].filter(Boolean);
  return (
    <button className="card card-btn row-card" onClick={onClick}>
      <FolderThumb folder={folder} />
      <div className="card-main">
        <strong className="ellipsis">{folder.name}</strong>
        {path && <span className="muted small ellipsis">{path}</span>}
        {folder.description && <span className="muted small clamp-2">{folder.description}</span>}
        <span className="muted small">{parts.length ? parts.join(' · ') : 'Leer'}</span>
      </div>
      <Icon name="chevron" />
    </button>
  );
}

export function FileCard({ file, path, onClick }: { file: FileItem; path?: string; onClick: () => void }) {
  const kind = fileKind(file);
  return (
    <button className="card card-btn row-card" onClick={onClick}>
      <FileThumb file={file} />
      <div className="card-main">
        <strong className="ellipsis">{fullName(file)}</strong>
        {path && <span className="muted small ellipsis">{path}</span>}
        {file.description && <span className="muted small clamp-2">{file.description}</span>}
        <span className="chips">
          <span className={`chip kind-chip kind-${kind}`}>{KIND_LABEL[kind]}</span>
          <span className="chip">{formatSize(file.size)}</span>
        </span>
      </div>
    </button>
  );
}
