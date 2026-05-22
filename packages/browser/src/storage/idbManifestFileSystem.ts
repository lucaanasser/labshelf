/**
 * Minimal LocalFileSystem implementation that stores a single JSON blob in the
 * IDB "manifest" store. Passed to SyncManifest.load so the sync engine can
 * persist its merge-base without needing a real filesystem path.
 *
 * Only readFile, writeFile, and stat are meaningful here — the other methods
 * are no-ops or empty stubs that satisfy the interface but are never called by
 * SyncManifest.
 *
 * @depends idb/db, @labshelf/core LocalFileSystem, LocalStat
 * @dependents sync/browserSyncController
 */
import type { LocalFileSystem, LocalStat } from "@labshelf/core";
import { getDb } from "./idb/db";

export class IdbManifestFileSystem implements LocalFileSystem {
  async readFile(filePath: string): Promise<Uint8Array> {
    const db = await getDb();
    const row = await db.get("manifest", filePath);
    if (!row) throw new Error(`Manifest not found: ${filePath}`);
    return new TextEncoder().encode(row.json);
  }

  async writeFile(filePath: string, content: Uint8Array): Promise<void> {
    const db = await getDb();
    const json = new TextDecoder().decode(content);
    await db.put("manifest", { providerId: filePath, json });
  }

  async stat(filePath: string): Promise<LocalStat | undefined> {
    const db = await getDb();
    const row = await db.get("manifest", filePath);
    if (!row) return undefined;
    const size = new TextEncoder().encode(row.json).length;
    return { isFile: true, isDirectory: false, mtimeMs: 0, size };
  }

  async listDir(_dirPath: string): Promise<string[]> { return []; }
  async deleteFile(filePath: string): Promise<void> {
    const db = await getDb();
    await db.delete("manifest", filePath);
  }
  async ensureDir(_dirPath: string): Promise<void> {}
}
