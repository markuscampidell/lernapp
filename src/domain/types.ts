/** Ein Ordner. parentId === null heißt: oberste Ebene (Ordner-Tab). */
export interface Folder {
  id: string;
  parentId: string | null;
  name: string;
  description?: string;
  /** Schlüssel des Vorschaubilds im Blob-Speicher. */
  imageId?: string;
  createdAt: string;
  updatedAt: string;
}

/** Eine Datei in einem Ordner. Der Inhalt liegt als Blob unter blobId. */
export interface FileItem {
  id: string;
  folderId: string;
  /** Anzeigename ohne Endung. */
  name: string;
  /** Dateiendung ohne Punkt, z. B. "pdf" (kann leer sein). */
  ext: string;
  description?: string;
  mime: string;
  size: number;
  blobId: string;
  /** Verkleinerte Vorschau (nur Bilder). */
  thumbId?: string;
  createdAt: string;
  updatedAt: string;
}

/** Datei, die per Android-"Teilen" ankam und noch einsortiert werden muss. */
export interface InboxItem {
  id: string;
  file: File;
  name: string;
  type: string;
  addedAt: number;
}

/** Ordner-Ebenen: 1 = Ordner im Ordner-Tab, 2–6 = Unterordner. */
export const MAX_DEPTH = 6;
