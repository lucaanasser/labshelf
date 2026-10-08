/**
 * LockStore for the core SyncLock over node:fs. vscode.workspace.fs has no exclusive create, which the lock needs to
 * be safe against the terminal app (or a second VS Code window) creating it at the same moment.
 *
 * @depends node:fs, @labshelf/core (LockStore)
 * @dependents sync/adapter/syncController.ts
 */
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";

import type { LockStore } from "@labshelf/core";

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
 * Whether a process with this pid runs on this machine (EPERM means it exists under another user).
 * @usedBy sync/adapter/syncController.ts (SyncLock liveness check)
 * @returns true when alive
 */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
