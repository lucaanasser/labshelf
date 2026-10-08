/**
 * Opens (and upgrades) the "labshelf" IndexedDB database. Returns a singleton
 * promise so callers share one connection across the extension lifetime.
 * @depends idb, idb/schema, idb/upgrade
 * @dependents indexedDbFileSystem, paperRecordStore, manifestStore
 */
import { openDB } from "idb";
import type { IDBPDatabase } from "idb";
import type { LabShelfSchema } from "./schema";
import { DB_VERSION, upgradeDb } from "./upgrade";

const DB_NAME = "labshelf";

let _db: Promise<IDBPDatabase<LabShelfSchema>> | null = null;

/** Returns a shared connection to the labshelf IndexedDB. */
export function getDb(): Promise<IDBPDatabase<LabShelfSchema>> {
  if (!_db) {
    _db = openDB<LabShelfSchema>(DB_NAME, DB_VERSION, {
      upgrade: (db, oldVersion, _newVersion, tx) => upgradeDb(db, oldVersion, tx),
    });
  }
  return _db;
}
