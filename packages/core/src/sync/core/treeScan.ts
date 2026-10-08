/**
 * Enumerate the local and remote file trees of a namespace into path-keyed maps consumed by the diff.
 */
import type { LocalFileSystem } from "../../ports/index.js";
import type { TreeNode } from "./syncTypes.js";
import type { RemoteFile, RemoteProvider } from "../provider/remoteProvider.js";
import type { RemotePathResolver } from "../provider/remotePathResolver.js";
import { sha256Hex } from "../util/contentHash.js";

// Joins a relative directory prefix and a child name into a POSIX path.
function joinPath(prefix: string, name: string): string {
  return prefix ? `${prefix}/${name}` : name;
}

/**
 * Recursively scans a local directory tree, hashing every file for comparison against the manifest base.
 * @returns Map<string, TreeNode>
 */
export async function scanLocalTree(
  fs: LocalFileSystem,
  rootPath: string,
): Promise<Map<string, TreeNode>> {
  const tree = new Map<string, TreeNode>();

  async function walk(absDir: string, relDir: string): Promise<void> {
    const names = await fs.listDir(absDir);
    for (const name of names) {
      const abs = `${absDir}/${name}`;
      const rel = joinPath(relDir, name);
      const stat = await fs.stat(abs);
      if (!stat) {
        continue;
      }
      if (stat.isDirectory) {
        await walk(abs, rel);
      } else if (stat.isFile) {
        const bytes = await fs.readFile(abs);
        tree.set(rel, {
          path: rel,
          contentHash: await sha256Hex(bytes),
          modifiedTime: new Date(stat.mtimeMs).toISOString(),
          size: stat.size,
        });
      }
    }
  }

  await walk(rootPath, "");
  return tree;
}

/** A proposed local name for a remote folder; a lower rank is a stronger claim on the name. */
export interface FolderNaming {
  name: string;
  rank: number;
}

/**
 * Decides the local name of a remote folder from the folder and what it directly holds; undefined falls back to the
 * display-name translation.
 */
export type RemoteFolderNamer = (folder: RemoteFile, children: RemoteFile[]) => Promise<FolderNaming | undefined>;

// Ranks of the fallbacks applied by scanRemoteTree itself.
const RANK_NAME_MAP = 3;
const RANK_DISPLAY = 4;

/**
 * Recursively scans a remote folder tree, registering discovered folders on the
 * resolver; folderNameMap translates remote display names to local names, and
 * nameFolder (when given) decides first, from the folder's contents.
 * @returns Map<string, TreeNode>
 */
export async function scanRemoteTree(
  provider: RemoteProvider,
  rootId: string,
  resolver: RemotePathResolver,
  folderNameMap?: Map<string, string>,
  nameFolder?: RemoteFolderNamer,
): Promise<Map<string, TreeNode>> {
  const tree = new Map<string, TreeNode>();

  async function walk(folderId: string, relDir: string, listed?: RemoteFile[]): Promise<void> {
    const children = listed ?? await provider.list(folderId);
    // Two remote folders must never share a local name — their files would be merged and one paper would overwrite
    // the other. Folders with the strongest claim (rank) take their name first; a later claimant falls back to its
    // display name, then to the display name plus part of its id.
    const taken = new Set(children.filter((c) => !c.isFolder).map((c) => c.name));
    const folders: Array<{ folder: RemoteFile; kids: RemoteFile[] | undefined; naming: FolderNaming }> = [];
    for (const folder of children.filter((c) => c.isFolder)) {
      // The namer needs the folder's contents; listing them here is the listing walk() would do anyway.
      const kids = nameFolder ? await provider.list(folder.id) : undefined;
      const mapped = folderNameMap?.get(folder.name);
      const naming = (kids ? await nameFolder!(folder, kids) : undefined)
        ?? (mapped ? { name: mapped, rank: RANK_NAME_MAP } : { name: folder.name, rank: RANK_DISPLAY });
      folders.push({ folder, kids, naming });
    }
    folders.sort((a, b) => a.naming.rank - b.naming.rank);
    for (const { folder, kids, naming } of folders) {
      let localName = naming.name;
      if (taken.has(localName)) { localName = folder.name; }
      if (taken.has(localName)) { localName = `${folder.name} (${folder.id.slice(-6)})`; }
      taken.add(localName);
      const rel = joinPath(relDir, localName);
      resolver.register(rel, folder.id);
      await walk(folder.id, rel, kids);
    }
    for (const child of children) {
      if (child.isFolder) { continue; }
      const rel = joinPath(relDir, child.name);
      const node: TreeNode = {
        path: rel,
        modifiedTime: child.modifiedTime,
        remoteId: child.id,
      };
      if (child.size !== undefined) {
        node.size = child.size;
      }
      // Drive allows two files with one name in a folder (left behind by the old appdata listing,
      // which uploaded a second data.json beside the first). Keep the newest, the last one written.
      const seen = tree.get(rel);
      if (!seen || seen.modifiedTime < child.modifiedTime) {
        tree.set(rel, node);
      }
    }
  }

  await walk(rootId, "");
  return tree;
}
