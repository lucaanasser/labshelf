/** The sync engine's LocalFileSystem over node:fs; writes are atomic through the library's temp folder. */
import { promises as fs } from "node:fs";

import type { LocalFileSystem, LocalStat } from "../../ports/index.js";
import { writeFileAtomic } from "./atomicWrite.js";

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
