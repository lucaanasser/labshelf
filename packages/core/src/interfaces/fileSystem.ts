/**
 * Platform-agnostic filesystem abstraction. Implementations live in the
 * consuming package (VS Code, browser) and are injected via constructor.
 *
 * Paths are POSIX-style relative or absolute strings — never platform URI
 * objects — so the same services run on top of vscode.workspace.fs and
 * IndexedDB without leaking platform details into core.
 *
 * @depends none
 * @dependents bibtexService, paperService (planned), logger adapters
 */
export interface IFileSystem {
  /** Creates a directory (and any parents) at the given path, idempotent. */
  ensureDir(path: string): Promise<void>;
  /** Writes a UTF-8 string to a file, overwriting any existing content. */
  writeText(path: string, content: string): Promise<void>;
  /** Reads a file and returns its contents as a UTF-8 string. */
  readText(path: string): Promise<string>;
  /** Returns true if the path exists (file or directory). */
  exists(path: string): Promise<boolean>;
}
