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
  /**
   * Remote root folder id each namespace was synced against. A different root (another account or OAuth client, or a
   * Drive folder that was replaced) means the entries describe some other remote and must not drive deletions.
   */
  roots?: Partial<Record<RemoteNamespace, string>>;
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
  /** True when the manifest did not describe this remote and the run started over as a first sync (no deletions). */
  rebased?: boolean;
}

/** Aggregated result of a full sync run. */
export interface SyncResult {
  providerId: string;
  namespaces: NamespaceResult[];
  startedAt: string;
  finishedAt: string;
}

