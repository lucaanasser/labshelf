/**
 * Derives the folder tree from the "files" IndexedDB store on demand. No
 * separate store is maintained — all queries scan path keys directly. Suitable
 * for the library page tree view (Phase 6) where the tree changes only after a
 * sync cycle.
 * @depends idb/db
 * @dependents library-page views (Phase 6), storage/index
 */
import { getDb } from "./idb/db";

export interface FolderNode {
  name: string;
  path: string;
  children: FolderNode[];
}

/** Returns the immediate sub-folder names under a directory prefix. */
export async function getDirectSubfolders(dirPath: string): Promise<string[]> {
  const db = await getDb();
  const prefix = dirPath ? `${dirPath}/` : "";
  const range = prefix
    ? IDBKeyRange.bound(prefix, `${prefix}￿`, false, true)
    : undefined;
  const keys = await db.getAllKeys("files", range);
  const seen = new Set<string>();
  for (const key of keys) {
    const rest = (key as string).slice(prefix.length);
    const sep = rest.indexOf("/");
    if (sep >= 0) {
      seen.add(rest.slice(0, sep));
    }
    // Plain files at this level are not folders — exclude them.
  }
  return [...seen].sort();
}

/** Recursively builds a FolderNode tree rooted at the given path. */
export async function buildFolderTree(rootPath: string = "papers"): Promise<FolderNode[]> {
  async function recurse(dirPath: string): Promise<FolderNode[]> {
    const subs = await getDirectSubfolders(dirPath);
    return Promise.all(
      subs.map(async (name) => {
        const path = dirPath ? `${dirPath}/${name}` : name;
        return { name, path, children: await recurse(path) };
      }),
    );
  }
  return recurse(rootPath);
}

/** Returns a flat list of all unique folder paths that contain at least one file. */
export async function listAllFolders(): Promise<string[]> {
  const db = await getDb();
  const keys = await db.getAllKeys("files");
  const folders = new Set<string>();
  for (const key of keys) {
    const parts = (key as string).split("/");
    // Collect every ancestor directory path
    for (let i = 1; i < parts.length; i++) {
      folders.add(parts.slice(0, i).join("/"));
    }
  }
  return [...folders].sort();
}
