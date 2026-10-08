/**
 * The library file system over the "files" IndexedDB store: keys are POSIX paths, and directories are the prefixes of
 * keys. Serves both the sync engine and the library mutations.
 */
import type { LibraryFileSystem, LocalStat } from "@labshelf/core";
import { sha256Hex } from "@labshelf/core";
import { belowDir, deleteTree, renameTree } from "./idbFileTree";
import { getDb } from "./idb/db";

export class IndexedDbFileSystem implements LibraryFileSystem {
  async listDir(dirPath: string): Promise<string[]> {
    const db = await getDb();
    const prefix = dirPath ? `${dirPath}/` : "";
    // Collect all keys that start with the prefix, then extract the first
    // child component (file name or sub-directory name).
    const range = prefix ? belowDir(dirPath) : undefined;
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
    const firstKey = await db.getKey("files", belowDir(targetPath));
    if (firstKey !== undefined) {
      return { isFile: false, isDirectory: true, mtimeMs: 0, size: 0 };
    }
    return undefined;
  }

  async ensureDir(_dirPath: string): Promise<void> {
    // Directories are implicit in the IDB file store; no sentinel needed.
  }

  async exists(targetPath: string): Promise<boolean> {
    return (await this.stat(targetPath)) !== undefined;
  }

  async writeText(filePath: string, text: string): Promise<void> {
    await this.writeFile(filePath, new TextEncoder().encode(text));
  }

  async readText(filePath: string): Promise<string> {
    return new TextDecoder().decode(await this.readFile(filePath));
  }

  /** Fails when the destination exists. */
  rename(from: string, to: string): Promise<void> {
    return renameTree(from, to);
  }

  /** The browser has no trash: the delete is permanent, and the next sync propagates it. */
  trash(target: string): Promise<void> {
    return deleteTree(target);
  }

  /** A folder is only its files, so an empty one is kept alive by a zero-byte `.keep`. */
  async mkdir(dir: string): Promise<void> {
    await this.writeFile(`${dir}/.keep`, new Uint8Array());
  }
}
