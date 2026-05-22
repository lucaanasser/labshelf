/**
 * Opens (and upgrades) the "labshelf" IndexedDB database. Returns a singleton
 * promise so callers share one connection across the extension lifetime.
 * @depends idb, idb/schema
 * @dependents indexedDbFileSystem, paperRecordStore, manifestStore
 */
import { openDB } from "idb";
import type { IDBPDatabase } from "idb";
import type { LabShelfSchema } from "./schema";

const DB_NAME = "labshelf";
const DB_VERSION = 1;

let _db: Promise<IDBPDatabase<LabShelfSchema>> | null = null;

/** Returns a shared connection to the labshelf IndexedDB. */
export function getDb(): Promise<IDBPDatabase<LabShelfSchema>> {
  if (!_db) {
    _db = openDB<LabShelfSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        const files = db.createObjectStore("files", { keyPath: "path" });
        files.createIndex("byHash", "hash");

        const meta = db.createObjectStore("metadata", { keyPath: "paperId" });
        meta.createIndex("byFolder", "folderPath");

        db.createObjectStore("manifest", { keyPath: "providerId" });
      },
    });
  }
  return _db;
}

/** Resets the singleton (for testing or extension reload). */
export function resetDb(): void {
  _db = null;
}
