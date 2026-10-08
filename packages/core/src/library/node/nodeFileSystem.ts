/** IFileSystem over node:fs; writes are atomic through the library's temp folder. */
import { promises as fs } from "node:fs";

import type { IFileSystem } from "../../ports/index.js";
import { writeFileAtomic } from "./atomicWrite.js";

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
