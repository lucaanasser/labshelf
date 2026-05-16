/** Maps relative POSIX paths to remote folder ids, creating intermediate folders on demand. @depends remoteProvider. @dependents syncApply, syncEngine, treeScan */
import type { RemoteProvider, RemoteFile } from "./remoteProvider.js";

/** POSIX dirname/basename split for relative sync paths. @usedBy syncApply, syncEngine. @returns { dir, name } */
export function splitPath(path: string): { dir: string; name: string } {
  const idx = path.lastIndexOf("/");
  return idx < 0
    ? { dir: "", name: path }
    : { dir: path.slice(0, idx), name: path.slice(idx + 1) };
}

/**
 * Resolves relative directory paths to remote folder ids, caching results
 * and creating folders that do not yet exist.
 */
export class RemotePathResolver {
  private readonly folderIds = new Map<string, string>();

  constructor(
    private readonly provider: RemoteProvider,
    rootId: string,
    knownFolders: Iterable<{ path: string; id: string }> = [],
    /** Maps local folder names to remote display names (e.g. paperId → title). */
    private readonly localToDisplay?: Map<string, string>,
  ) {
    this.folderIds.set("", rootId);
    for (const { path, id } of knownFolders) {
      this.folderIds.set(path, id);
    }
  }

  /** Records a folder discovered while scanning the remote tree. @usedBy treeScan. @returns void */
  register(path: string, id: string): void {
    this.folderIds.set(path, id);
  }

  /** Returns the remote folder id for a directory path, creating missing intermediate folders as needed. @usedBy parentOf. @returns string */
  async ensureFolder(dirPath: string): Promise<string> {
    const cached = this.folderIds.get(dirPath);
    if (cached) return cached;

    const { dir, name } = splitPath(dirPath);
    const parentId = await this.ensureFolder(dir);
    const displayName = this.localToDisplay?.get(name) ?? name;
    const created: RemoteFile = await this.provider.createFolder(
      parentId,
      displayName,
    );
    this.folderIds.set(dirPath, created.id);
    return created.id;
  }

  /** Resolves the remote parent folder id of a file path. @usedBy syncApply. @returns string */
  async parentOf(filePath: string): Promise<string> {
    return this.ensureFolder(splitPath(filePath).dir);
  }
}
