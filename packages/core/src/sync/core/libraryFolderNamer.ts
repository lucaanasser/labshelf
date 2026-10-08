/**
 * Decides the local folder name of each Drive folder in the "library" namespace. Drive folders of papers are named
 * after titles (see folderNames.ts), locally they are named after the paper id; a device that does not know a title
 * yet (a paper added elsewhere), or that knew an older title, used to bring the folder down under its title, giving
 * the paper a second id and orphaning its sidecar. The rules, in order:
 *
 *  1. A folder synced before keeps the local name its files were synced under (found through the manifest by remote
 *     file id) — so nothing already on disk is ever renamed by a title change.
 *  2. A paper folder new to this device is named after the citekey in its metadata.yaml, which every LabShelf surface
 *     writes equal to the paper id (preferred over the title, which two papers may share).
 *  3. A title this device knows maps to its paper id.
 *  4. Otherwise the display name is kept (collections, foreign folders).
 *
 * The rank of each answer lets scanRemoteTree settle two folders claiming one name: the stronger claim keeps it.
 *
 * @depends syncManifest, provider/remoteProvider, library/paperMetadata, treeScan (RemoteFolderNamer)
 * @dependents syncEngine
 */
import { parsePaperMetadata } from "../../library/paperMetadata.js";
import type { RemoteProvider } from "../provider/remoteProvider.js";
import type { SyncManifest } from "./syncManifest.js";
import type { FolderNaming, RemoteFolderNamer } from "./treeScan.js";

const METADATA_FILE = "metadata.yaml";

export interface LibraryFolderNamerDeps {
  provider: RemoteProvider;
  manifest: SyncManifest;
  /** Remote display name → local folder name, from the surface's own index (titles → paper ids). */
  titles?: Map<string, string>;
}

/**
 * Whether a cite key can be used as a folder name on every platform the library syncs to.
 * @usedBy createLibraryFolderNamer
 * @returns true when safe
 */
export function isSafeFolderName(name: string): boolean {
  return name.length > 0 && name.length <= 255 && name !== "." && name !== ".." && !/[\x00-\x1f\x7f/\\]/.test(name);
}

/**
 * Builds the namer for one sync run.
 * @usedBy syncEngine
 * @returns the namer passed to scanRemoteTree
 */
export function createLibraryFolderNamer(deps: LibraryFolderNamerDeps): RemoteFolderNamer {
  const pathByRemoteId = new Map<string, string>();
  for (const path of deps.manifest.paths("library")) {
    const entry = deps.manifest.get("library", path);
    if (entry) { pathByRemoteId.set(entry.remoteId, path); }
  }
  const titled = (folder: { name: string }): FolderNaming | undefined => {
    const id = deps.titles?.get(folder.name);
    return id ? { name: id, rank: 3 } : undefined;
  };
  return async (folder, children) => {
    for (const child of children) {
      if (child.isFolder) { continue; }
      const known = pathByRemoteId.get(child.id);
      const parts = known?.split("/");
      const name = parts && parts.length >= 2 ? parts[parts.length - 2] : undefined;
      if (name) { return { name, rank: 1 }; }
    }
    const metadata = children.find((child) => !child.isFolder && child.name === METADATA_FILE);
    if (!metadata) { return titled(folder); }
    try {
      const meta = parsePaperMetadata(new TextDecoder("utf-8").decode(await deps.provider.download(metadata.id)));
      const citekey = meta?.["citekey"];
      if (typeof citekey === "string" && isSafeFolderName(citekey.trim())) { return { name: citekey.trim(), rank: 2 }; }
    } catch {
      // Unreadable metadata: fall back to the title or the display name rather than failing the whole sync.
    }
    return titled(folder);
  };
}
