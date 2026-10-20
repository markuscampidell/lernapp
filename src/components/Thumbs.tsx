import type { FileItem, Folder } from '../domain/types';
import { useBlobUrl } from '../hooks/useBlobUrl';
import { fileKind, type FileKind } from '../lib/files';
import { Icon, type IconName } from './Icon';

const KIND_ICON: Record<FileKind, IconName> = {
  image: 'image',
  pdf: 'pdf',
  text: 'text',
  video: 'video',
  audio: 'audio',
  presentation: 'presentation',
  document: 'document',
  spreadsheet: 'spreadsheet',
  archive: 'archive',
  other: 'file',
};

export function FolderThumb({ folder, size = 'md' }: { folder: Pick<Folder, 'imageId'>; size?: 'md' | 'lg' }) {
  const url = useBlobUrl(folder.imageId);
  return (
    <span className={`thumb folder-thumb ${size}`}>
      {url ? <img src={url} alt="" /> : <Icon name="folder" size={size === 'lg' ? 30 : 22} />}
    </span>
  );
}

export function FileThumb({ file }: { file: FileItem }) {
  const url = useBlobUrl(file.thumbId);
  const kind = fileKind(file);
  return (
    <span className={`thumb file-thumb kind-${kind}`}>
      {url ? <img src={url} alt="" /> : <Icon name={KIND_ICON[kind]} size={22} />}
    </span>
  );
}

export const kindIcon = (k: FileKind) => KIND_ICON[k];
