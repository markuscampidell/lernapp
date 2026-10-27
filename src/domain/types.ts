/** Rechte der anderen Mitglieder: nur lesen / lesen & bearbeiten / lesen, bearbeiten & löschen. */
export type Access = 'read' | 'edit' | 'delete';

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
  /** Nur bei geteilten Ordnern/Dateien (bzw. beim lokalen Platzhalter eines geteilten Ordners): ID des geteilten Ordners. */
  shareId?: string;
  /** Wer den Eintrag erstellt / zuletzt geändert hat (nur geteilt). */
  createdBy?: string | null;
  updatedBy?: string | null;
  /** Was andere Mitglieder dürfen (nur geteilt); null/undefined = wie der übergeordnete Ordner. */
  access?: Access | null;
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
  /** Nur bei geteilten Ordnern/Dateien (bzw. beim lokalen Platzhalter eines geteilten Ordners): ID des geteilten Ordners. */
  shareId?: string;
  /** Wer den Eintrag erstellt / zuletzt geändert hat (nur geteilt). */
  createdBy?: string | null;
  updatedBy?: string | null;
  /** Was andere Mitglieder dürfen (nur geteilt); null/undefined = wie der übergeordnete Ordner. */
  access?: Access | null;
}

/** Datei, die per Android-"Teilen" ankam und noch einsortiert werden muss. */
export interface InboxItem {
  id: string;
  file: File;
  name: string;
  type: string;
  addedAt: number;
}

/** Pseudo-Elternordner für geteilte Ordner, die in „Geteilte Ordner“ erscheinen. */
export const SHARED_ROOT = '__geteilt__';

/** Ordner-Ebenen: 1 = Ordner im Ordner-Tab, 2–6 = Unterordner. */
export const MAX_DEPTH = 6;
