/**
 * Module: Tree Scan
 * Responsibility: Enumerate the local and remote file trees of a namespace
 *   into path-keyed maps consumed by the diff
 * Dependencies: syncTypes, remoteProvider, remotePathResolver, contentHash
 */
import type { LocalFileSystem, TreeNode } from "./syncTypes.js";
import type { RemoteProvider } from "../provider/remoteProvider.js";
import type { RemotePathResolver } from "../provider/remotePathResolver.js";
import { sha256Hex } from "../util/contentHash.js";

function joinPath(prefix: string, name: string): string {
  return prefix ? `${prefix}/${name}` : name;
}

/**
 * Recursively scans a local directory tree. Hashes every file so the diff
 * can compare against the manifest base.
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
      if (!stat) continue;
      if (stat.isDirectory) {
        await walk(abs, rel);
      } else if (stat.isFile) {
        const bytes = await fs.readFile(abs);
        tree.set(rel, {
          path: rel,
          contentHash: sha256Hex(bytes),
          modifiedTime: new Date(stat.mtimeMs).toISOString(),
          size: stat.size,
        });
      }
    }
  }

  await walk(rootPath, "");
  return tree;
}

/**
 * Recursively scans a remote folder tree, registering discovered folders on
 * the resolver so the apply step can reuse their ids.
 * folderNameMap translates remote display names → local names (e.g. title → id).
 */
export async function scanRemoteTree(
  provider: RemoteProvider,
  rootId: string,
  resolver: RemotePathResolver,
  folderNameMap?: Map<string, string>,
): Promise<Map<string, TreeNode>> {
  const tree = new Map<string, TreeNode>();

  async function walk(folderId: string, relDir: string): Promise<void> {
    const children = await provider.list(folderId);
    for (const child of children) {
      const localName = (child.isFolder ? folderNameMap?.get(child.name) : undefined) ?? child.name;
      const rel = joinPath(relDir, localName);
      if (child.isFolder) {
        resolver.register(rel, child.id);
        await walk(child.id, rel);
      } else {
        const node: TreeNode = {
          path: rel,
          modifiedTime: child.modifiedTime,
          remoteId: child.id,
        };
        if (child.size !== undefined) node.size = child.size;
        tree.set(rel, node);
      }
    }
  }

  await walk(rootId, "");
  return tree;
}
