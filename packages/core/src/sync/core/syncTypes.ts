/**
 * Shared types for the sync engine — manifest entries, three-way diff classes,
 * sync results, and the local filesystem abstraction.
 *
 * @depends sync/provider/remoteProvider
 * @dependents syncManifest, treeScan, syncDiff, syncApply, syncEngine, syncController
 */
import type { RemoteNamespace } from "../provider/remoteProvider.js";

/** One manifest entry: state of a path at the last successful sync. */
export interface ManifestEntry {
  /** Remote file id at the time of the last sync. */
  remoteId: string;
  /** SHA-256 hex digest of the content at the last sync. */
  contentHash: string;
  /** ISO-8601 remote modifiedTime at the last sync. */
  modifiedTime: string;
}

/** The manifest is keyed by namespace, then by relative POSIX path. */
export interface ManifestData {
  providerId: string;
  namespaces: Record<RemoteNamespace, Record<string, ManifestEntry>>;
}

/** Classification of a single path in the three-way diff. */
export type DiffClass =
  | "unchanged"
  | "local-new"
  | "remote-new"
  | "local-modified"
  | "remote-modified"
  | "local-deleted"
  | "remote-deleted"
  | "conflict";

/** A file present in a scanned tree (local or remote). */
export interface TreeNode {
  /** Relative POSIX path from the namespace root. */
  path: string;
  /** SHA-256 hex digest of the content (local trees only). */
  contentHash?: string;
  /** ISO-8601 modified time. */
  modifiedTime: string;
  /** Remote id (remote trees only). */
  remoteId?: string;
  size?: number;
}

/** A planned operation produced by the diff and consumed by the apply step. */
export interface SyncOperation {
  path: string;
  class: DiffClass;
  local?: TreeNode;
  remote?: TreeNode;
}

/** Outcome of running the engine for one namespace. */
export interface NamespaceResult {
  namespace: RemoteNamespace;
  uploaded: number;
  downloaded: number;
  deletedLocal: number;
  deletedRemote: number;
  conflicts: string[];
}

/** Aggregated result of a full sync run. */
export interface SyncResult {
  providerId: string;
  namespaces: NamespaceResult[];
  startedAt: string;
  finishedAt: string;
}

/** Stat of a local file. */
export interface LocalStat {
  isFile: boolean;
  isDirectory: boolean;
  /** Epoch milliseconds of the last modification. */
  mtimeMs: number;
  size: number;
}

/**
 * Platform-agnostic local filesystem abstraction. The concrete adapter is
 * injected; this module never imports vscode or node:fs directly.
 */
export interface LocalFileSystem {
  /** Lists immediate child names of a directory. Returns [] if missing. */
  listDir(dirPath: string): Promise<string[]>;
  readFile(filePath: string): Promise<Uint8Array>;
  writeFile(filePath: string, content: Uint8Array): Promise<void>;
  deleteFile(filePath: string): Promise<void>;
  /** Returns undefined when the path does not exist. */
  stat(targetPath: string): Promise<LocalStat | undefined>;
  /** Ensures a directory (and parents) exist. */
  ensureDir(dirPath: string): Promise<void>;
}
