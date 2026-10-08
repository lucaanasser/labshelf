/**
 * Schema upgrade steps for the "labshelf" IndexedDB database. Each step only
 * changes structure; the rows in the stores are never touched.
 */
import type { IDBPDatabase, IDBPTransaction } from "idb";
import type { LabShelfSchema } from "./schema";

export const DB_VERSION = 2;

type UpgradeTx = IDBPTransaction<LabShelfSchema, string[], "versionchange">;

/** Brings a database from `oldVersion` (0 for a new one) to DB_VERSION. */
export function upgradeDb(db: IDBPDatabase<LabShelfSchema>, oldVersion: number, tx: UpgradeTx): void {
  if (oldVersion < 1) {
    db.createObjectStore("files", { keyPath: "path" });
    db.createObjectStore("metadata", { keyPath: "paperId" });
    db.createObjectStore("manifest", { keyPath: "providerId" });
    return;
  }
  if (oldVersion < 2) {
    // Version 1 indexed files by hash and metadata by folder; nothing queries them.
    for (const [store, index] of [["files", "byHash"], ["metadata", "byFolder"]] as const) {
      const objectStore = tx.objectStore(store);
      if (objectStore.indexNames.contains(index as never)) objectStore.deleteIndex(index);
    }
  }
}
