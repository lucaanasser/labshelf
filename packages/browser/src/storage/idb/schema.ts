/**
 * IndexedDB store definitions for the labshelf browser extension. Version 1
 * schema: files (raw bytes), metadata (PaperRecord cache), manifest (sync state).
 * @depends @labshelf/core PaperRecord
 * @dependents idb/db, indexedDbFileSystem, paperRecordStore, manifestStore
 */
import type { PaperRecord } from "@labshelf/core";

/** Raw file content keyed by its POSIX path relative to the library root. */
export interface FileRow {
  path: string;
  bytes: Uint8Array;
  /** Epoch milliseconds of the last write. */
  mtime: number;
  /** SHA-256 hex digest — used by treeScan without re-reading bytes. */
  hash: string;
}

/** Cached PaperRecord derived from the metadata.yaml sidecar of each paper. */
export interface MetadataRow {
  /** Same as PaperRecord.id. */
  paperId: string;
  record: PaperRecord;
  /** "papers/<citeKey>" — indexed for fast folder-prefix queries. */
  folderPath: string;
}

/** Serialised ManifestData for the Drive sync provider. */
export interface ManifestRow {
  providerId: string;
  json: string;
}

export interface LabShelfSchema {
  files: {
    key: string;
    value: FileRow;
    indexes: { byHash: string };
  };
  metadata: {
    key: string;
    value: MetadataRow;
    indexes: { byFolder: string };
  };
  manifest: {
    key: string;
    value: ManifestRow;
  };
}
