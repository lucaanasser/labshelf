/**
 * SidecarPort over the extension's IndexedDB file store. A paper's sidecar lives at appdata/<paperId>/data.json: the
 * sync "appdata" namespace root in this browser, which VS Code maps to <library>/.research/papers, so annotations,
 * reader theme and reading position written here reach the VS Code reader and back.
 *
 * @depends storage/indexedDbFileSystem, @labshelf/reader (SidecarPort)
 * @dependents reader/index
 */
import type { SidecarPort } from "@labshelf/reader";
import type { IndexedDbFileSystem } from "../storage/indexedDbFileSystem";

/** Must match BrowserSyncController ROOTS.appdata. */
export const APPDATA_ROOT = "appdata";

/**
 * @usedBy createIdbSidecarPort, reader/index
 * @returns the IndexedDB path of a paper's sidecar.
 */
export function sidecarPath(paperId: string): string {
  return `${APPDATA_ROOT}/${paperId}/data.json`;
}

/**
 * @usedBy reader/index
 * @returns a SidecarPort reading and writing UTF-8 JSON in the IndexedDB file store.
 */
export function createIdbSidecarPort(fs: Pick<IndexedDbFileSystem, "stat" | "readFile" | "writeFile">): SidecarPort {
  return {
    async read(paperId) {
      const path = sidecarPath(paperId);
      if (!(await fs.stat(path))?.isFile) return null;
      return new TextDecoder().decode(await fs.readFile(path));
    },
    async write(paperId, text) {
      await fs.writeFile(sidecarPath(paperId), new TextEncoder().encode(text));
    },
  };
}
