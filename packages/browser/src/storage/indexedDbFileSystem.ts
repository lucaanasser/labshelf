/**
 * LocalFileSystem implementation backed by the "files" IndexedDB store.
 * Directories are virtual — they emerge from path prefixes, no sentinel rows
 * are written. Implements the LocalFileSystem interface from @labshelf/core so
 * the SyncEngine can drive it without modification.
 * @depends idb/db, @labshelf/core sha256Hex, LocalFileSystem, LocalStat
 * @dependents sync/browserSyncController (Phase 4), storage/index
 */
import type { LocalFileSystem, LocalStat } from "@labshelf/core";
import { sha256Hex } from "@labshelf/core";
import { getDb } from "./idb/db";

export class IndexedDbFileSystem implements LocalFileSystem {
  async listDir(dirPath: string): Promise<string[]> {
    const db = await getDb();
    const prefix = dirPath ? `${dirPath}/` : "";
    // Collect all keys that start with the prefix, then extract the first
    // child component (file name or sub-directory name).
    const range = prefix
      ? IDBKeyRange.bound(prefix, `${prefix}￿`, false, true)
      : undefined;
    const keys = await db.getAllKeys("files", range);
    const seen = new Set<string>();
    for (const key of keys) {
      const rest = (key as string).slice(prefix.length);
      const sep = rest.indexOf("/");
      seen.add(sep < 0 ? rest : rest.slice(0, sep));
    }
    return [...seen];
  }

  async readFile(filePath: string): Promise<Uint8Array> {
    const db = await getDb();
    const row = await db.get("files", filePath);
    if (!row) throw new Error(`File not found: ${filePath}`);
    return row.bytes;
  }

  async writeFile(filePath: string, content: Uint8Array): Promise<void> {
    const db = await getDb();
    const hash = await sha256Hex(content);
    await db.put("files", { path: filePath, bytes: content, mtime: Date.now(), hash });
  }

  async deleteFile(filePath: string): Promise<void> {
    const db = await getDb();
    await db.delete("files", filePath);
  }

  async stat(targetPath: string): Promise<LocalStat | undefined> {
    const db = await getDb();
    const row = await db.get("files", targetPath);
    if (row) {
      return { isFile: true, isDirectory: false, mtimeMs: row.mtime, size: row.bytes.length };
    }
    // Treat as a directory if any key begins with targetPath + "/"
    const prefix = `${targetPath}/`;
    const range = IDBKeyRange.bound(prefix, `${prefix}￿`, false, true);
    const firstKey = await db.getKey("files", range);
    if (firstKey !== undefined) {
      return { isFile: false, isDirectory: true, mtimeMs: 0, size: 0 };
    }
    return undefined;
  }

  async ensureDir(_dirPath: string): Promise<void> {
    // Directories are implicit in the IDB file store; no sentinel needed.
  }

  /** Returns the SHA-256 hash stored alongside the file without re-hashing. */
  async getHash(filePath: string): Promise<string | undefined> {
    const db = await getDb();
    const row = await db.get("files", filePath);
    return row?.hash;
  }

  /** Deletes all files whose path starts with the given directory prefix. */
  async deleteDir(dirPath: string): Promise<void> {
    const db = await getDb();
    const prefix = `${dirPath}/`;
    const range = IDBKeyRange.bound(prefix, `${prefix}￿`, false, true);
    const tx = db.transaction("files", "readwrite");
    let cursor = await tx.store.openCursor(range);
    while (cursor) {
      await cursor.delete();
      cursor = await cursor.continue();
    }
    await tx.done;
  }
}
