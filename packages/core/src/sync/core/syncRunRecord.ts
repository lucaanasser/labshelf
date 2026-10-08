/**
 * The record of the last successful sync of a library, shared by every app that syncs it (".research/sync/
 * <providerId>.last.json"). It lets each app show when the library last synced and from where, and lets an app skip a
 * periodic run when another one just synced.
 */
import type { LocalFileSystem } from "../../ports/index.js";
import type { SyncResult } from "./syncTypes.js";

export interface SyncRunRecord {
  providerId: string;
  /** "vscode", "terminal", … */
  app: string;
  host: string;
  startedAt: string;
  finishedAt: string;
  uploaded: number;
  downloaded: number;
  deletedLocal: number;
  deletedRemote: number;
  conflicts: string[];
}

/**
 * Flattens a SyncResult into the shared record.
 * @usedBy writeSyncRunRecord callers
 * @returns the record
 */
export function summarizeSyncResult(result: SyncResult, app: string, host: string): SyncRunRecord {
  const sum = (key: "uploaded" | "downloaded" | "deletedLocal" | "deletedRemote"): number =>
    result.namespaces.reduce((acc, ns) => acc + ns[key], 0);
  return {
    providerId: result.providerId,
    app,
    host,
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
    uploaded: sum("uploaded"),
    downloaded: sum("downloaded"),
    deletedLocal: sum("deletedLocal"),
    deletedRemote: sum("deletedRemote"),
    conflicts: result.namespaces.flatMap((ns) => ns.conflicts),
  };
}

/**
 * Writes the record next to the manifest.
 * @usedBy @labshelf/vscode syncController, @labshelf/terminal syncService
 * @returns void
 */
export async function writeSyncRunRecord(fs: LocalFileSystem, path: string, record: SyncRunRecord): Promise<void> {
  await fs.writeFile(path, new TextEncoder().encode(JSON.stringify(record, null, 2)));
}

/**
 * Reads the record; a missing or unreadable file reads as "never synced".
 * @usedBy @labshelf/terminal syncService
 * @returns the record, or undefined
 */
export async function readSyncRunRecord(fs: LocalFileSystem, path: string): Promise<SyncRunRecord | undefined> {
  const stat = await fs.stat(path);
  if (!stat?.isFile) { return undefined; }
  try {
    const raw = JSON.parse(new TextDecoder().decode(await fs.readFile(path))) as Partial<SyncRunRecord>;
    if (typeof raw.finishedAt !== "string" || !Number.isFinite(Date.parse(raw.finishedAt))) { return undefined; }
    return {
      providerId: typeof raw.providerId === "string" ? raw.providerId : "",
      app: typeof raw.app === "string" ? raw.app : "unknown",
      host: typeof raw.host === "string" ? raw.host : "",
      startedAt: typeof raw.startedAt === "string" ? raw.startedAt : raw.finishedAt,
      finishedAt: raw.finishedAt,
      uploaded: typeof raw.uploaded === "number" ? raw.uploaded : 0,
      downloaded: typeof raw.downloaded === "number" ? raw.downloaded : 0,
      deletedLocal: typeof raw.deletedLocal === "number" ? raw.deletedLocal : 0,
      deletedRemote: typeof raw.deletedRemote === "number" ? raw.deletedRemote : 0,
      conflicts: Array.isArray(raw.conflicts) ? raw.conflicts.filter((c): c is string => typeof c === "string") : [],
    };
  } catch {
    return undefined;
  }
}
