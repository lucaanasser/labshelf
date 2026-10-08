/**
 * Local filesystem port used by sync and library scans; the app supplies the adapter.
 */
/** Stat of a local file. */
export interface LocalStat {
  isFile: boolean;
  isDirectory: boolean;
  /** Epoch milliseconds of the last modification. */
  mtimeMs: number;
  size: number;
}

/**
 * Platform-agnostic local filesystem abstraction. The concrete adapter is
 * injected; this module never imports vscode or node:fs directly.
 */
export interface LocalFileSystem {
  /** Lists immediate child names of a directory. Returns [] if missing. */
  listDir(dirPath: string): Promise<string[]>;
  readFile(filePath: string): Promise<Uint8Array>;
  writeFile(filePath: string, content: Uint8Array): Promise<void>;
  deleteFile(filePath: string): Promise<void>;
  /** Returns undefined when the path does not exist. */
  stat(targetPath: string): Promise<LocalStat | undefined>;
  /** Ensures a directory (and parents) exist. */
  ensureDir(dirPath: string): Promise<void>;
}
