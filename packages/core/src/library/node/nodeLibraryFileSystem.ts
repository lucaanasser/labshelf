/** The LibraryFileSystem port over node:fs, for VS Code and the terminal; the trash comes from the app. */
import { promises as fs } from "node:fs";

import type { LibraryFileSystem, LocalStat } from "../../ports/index.js";
import { NodeFileSystem } from "./nodeFileSystem.js";
import { NodeLocalFileSystem } from "./nodeLocalFileSystem.js";

export class NodeLibraryFileSystem implements LibraryFileSystem {
  private readonly text: NodeFileSystem;
  private readonly local: NodeLocalFileSystem;

  /**
   * @param moveToTrash the platform trash (the terminal's `trash` package, VS Code's `useTrash` delete)
   * @param tmpDir the library's temp folder, so atomic writes rename within one volume
   */
  constructor(private readonly moveToTrash: (target: string) => Promise<unknown>, tmpDir?: string) {
    this.text = new NodeFileSystem(tmpDir);
    this.local = new NodeLocalFileSystem(tmpDir);
  }

  ensureDir(dir: string): Promise<void> { return this.text.ensureDir(dir); }
  writeText(file: string, content: string): Promise<void> { return this.text.writeText(file, content); }
  readText(file: string): Promise<string> { return this.text.readText(file); }
  exists(target: string): Promise<boolean> { return this.text.exists(target); }
  readFile(file: string): Promise<Uint8Array> { return this.local.readFile(file); }
  writeFile(file: string, content: Uint8Array): Promise<void> { return this.local.writeFile(file, content); }
  deleteFile(file: string): Promise<void> { return this.local.deleteFile(file); }
  stat(target: string): Promise<LocalStat | undefined> { return this.local.stat(target); }

  // Only a missing folder lists as empty: an import walk must be able to report a folder it may not read.
  async listDir(dir: string): Promise<string[]> {
    try {
      return await fs.readdir(dir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") { return []; }
      throw error;
    }
  }

  async rename(from: string, to: string): Promise<void> {
    await fs.rename(from, to);
  }

  async trash(target: string): Promise<void> {
    await this.moveToTrash(target);
  }

  async mkdir(dir: string): Promise<void> {
    await fs.mkdir(dir, { recursive: true });
  }
}
