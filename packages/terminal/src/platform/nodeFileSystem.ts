/**
 * node:fs adapters for the core interfaces: IFileSystem (BibTeX/metadata writes), LocalFileSystem (the sync engine)
 * and LockStore (the cross-process sync lock). Every write goes to a temporary file under .research/tmp/ and is renamed
 * into place, so the VS Code extension, a sync scan or a file watcher never sees half a file — and the temporary
 * files never sit inside the synced folders.
 *
 * @depends @labshelf/core (interfaces)
 * @dependents app/context, library/*, sync/*
 */
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";

import type { IFileSystem, LocalFileSystem, LocalStat, LockStore } from "@labshelf/core";

/**
 * Writes a file atomically: temp file in tmpDir (same volume as the library), then rename over the target.
 * @usedBy NodeFileSystem, NodeLocalFileSystem
 * @returns void
 */
export async function writeFileAtomic(target: string, content: string | Uint8Array, tmpDir?: string): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const dir = tmpDir ?? path.dirname(target);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(target)}.${randomUUID()}.tmp`);
  try {
    await fs.writeFile(tmp, content);
    await fs.rename(tmp, target);
  } catch (error) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    // A temp dir on another volume (rename EXDEV) falls back to a direct write.
    if ((error as NodeJS.ErrnoException).code === "EXDEV") {
      await fs.writeFile(target, content);
      return;
    }
    throw error;
  }
}

/** IFileSystem over node:fs, used by the core BibTeXService. */
export class NodeFileSystem implements IFileSystem {
  constructor(private readonly tmpDir?: string) {}

  async ensureDir(dirPath: string): Promise<void> {
    await fs.mkdir(dirPath, { recursive: true });
  }

  async writeText(filePath: string, content: string): Promise<void> {
    await writeFileAtomic(filePath, content, this.tmpDir);
  }

  async readText(filePath: string): Promise<string> {
    return fs.readFile(filePath, "utf8");
  }

  async exists(target: string): Promise<boolean> {
    try {
      await fs.stat(target);
      return true;
    } catch {
      return false;
    }
  }
}

/** The sync engine's LocalFileSystem over node:fs. */
export class NodeLocalFileSystem implements LocalFileSystem {
  constructor(private readonly tmpDir?: string) {}

  // The sync engine must see exactly the tree VS Code's adapter sees, since both share one manifest: no name filter
  // here (temp files of atomic writes live in .research/tmp/, outside the synced roots).
  async listDir(dirPath: string): Promise<string[]> {
    try {
      return await fs.readdir(dirPath);
    } catch {
      return [];
    }
  }

  async readFile(filePath: string): Promise<Uint8Array> {
    return new Uint8Array(await fs.readFile(filePath));
  }

  async writeFile(filePath: string, content: Uint8Array): Promise<void> {
    await writeFileAtomic(filePath, content, this.tmpDir);
  }

  async deleteFile(filePath: string): Promise<void> {
    await fs.rm(filePath, { force: true });
  }

  // lstat, like VS Code's FileType check: a symlink is neither a file nor a folder to the sync. Following it here
  // while VS Code skips it would make each app undo the other's upload or deletion on every run.
  async stat(target: string): Promise<LocalStat | undefined> {
    try {
      const s = await fs.lstat(target);
      return { isFile: s.isFile(), isDirectory: s.isDirectory(), mtimeMs: s.mtimeMs, size: s.size };
    } catch {
      return undefined;
    }
  }

  async ensureDir(dirPath: string): Promise<void> {
    await fs.mkdir(dirPath, { recursive: true });
  }
}

/** LockStore over node:fs; the exclusive create uses O_EXCL ("wx"). */
export class NodeLockStore implements LockStore {
  async createExclusive(filePath: string, text: string): Promise<boolean> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    // Written whole to a private temp file, then hard-linked into place: link() fails if the lock exists, and the
    // other app can never read it empty (an O_EXCL create would be visible before its content).
    const tmp = `${filePath}.${randomUUID()}.tmp`;
    await fs.writeFile(tmp, text);
    try {
      await fs.link(tmp, filePath);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") { return false; }
      throw error;
    } finally {
      await fs.rm(tmp, { force: true });
    }
  }

  async read(filePath: string): Promise<string | undefined> {
    try {
      return await fs.readFile(filePath, "utf8");
    } catch {
      return undefined;
    }
  }

  async write(filePath: string, text: string): Promise<void> {
    // Heartbeats replace the file whole (temp + rename): a half-written lock would read as abandoned.
    const tmp = `${filePath}.${randomUUID()}.tmp`;
    await fs.writeFile(tmp, text);
    await fs.rename(tmp, filePath);
  }

  async remove(filePath: string): Promise<void> {
    await fs.rm(filePath, { force: true });
  }
}

/**
 * Whether a process with this pid is running on this machine.
 * @usedBy sync/syncService (SyncLock liveness check)
 * @returns true when it exists (or exists but belongs to another user)
 */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
