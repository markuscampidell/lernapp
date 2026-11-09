import type { FileItem, Folder } from '../domain/types';
import { useBlobUrl } from '../hooks/useBlobUrl';
import { fileKind, type FileKind } from '../lib/files';
import { Icon, type IconName } from './Icon';
import { openLightbox } from './Lightbox';

/** Macht ein Vorschaubild antippbar (groß anzeigen), ohne den Klick an die Karte weiterzugeben. */
const zoomProps = (open: () => void, label: string) => {
  const run = (e: React.SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
    open();
  };
  return {
    role: 'button',
    tabIndex: 0,
    title: 'Vergrößern',
    'aria-label': `${label} vergrößern`,
    onClick: run,
    onKeyDown: (e: React.KeyboardEvent) => (e.key === 'Enter' || e.key === ' ') && run(e),
  };
};

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
  flashcards: 'cards',
  quiz: 'quiz',
  richtext: 'richdoc',
  chart: 'chart',
  wheel: 'wheel',
  gaps: 'gaps',
  other: 'file',
};

export function FolderThumb({ folder, size = 'md', expand }: { folder: Pick<Folder, 'imageId'> & { name?: string }; size?: 'md' | 'lg'; expand?: boolean }) {
  const url = useBlobUrl(folder.imageId);
  const zoom = expand && url ? zoomProps(() => openLightbox({ src: url, alt: folder.name }), 'Ordnerbild') : {};
  return (
    <span className={`thumb folder-thumb ${size}${expand && url ? ' zoomable' : ''}`} {...zoom}>
      {url ? <img src={url} alt="" /> : <Icon name="folder" size={size === 'lg' ? 30 : 22} />}
    </span>
  );
}

export function FileThumb({ file, expand }: { file: FileItem; expand?: boolean }) {
  const url = useBlobUrl(file.thumbId);
  const kind = fileKind(file);
  // Groß wird das Original nachgeladen (die Vorschau ist nur klein).
  const zoom = expand && url ? zoomProps(() => openLightbox({ src: url, fullId: file.blobId, alt: file.name }), 'Bild') : {};
  return (
    <span className={`thumb file-thumb kind-${kind}${expand && url ? ' zoomable' : ''}`} {...zoom}>
      {url ? <img src={url} alt="" /> : <Icon name={KIND_ICON[kind]} size={22} />}
    </span>
  );
}

export const kindIcon = (k: FileKind) => KIND_ICON[k];
