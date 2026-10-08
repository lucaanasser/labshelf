/**
 * SidecarPort over the extension's IndexedDB file store. A paper's sidecar lives at appdata/<paperId>/data.json: the
 * sync "appdata" namespace root in this browser, which VS Code maps to <library>/.research/papers, so annotations,
 * reader theme and reading position written here reach the VS Code reader and back.
 */
import { APPDATA_DIR, SIDECAR_FILE, type SidecarPort } from "@labshelf/core";
import type { IndexedDbFileSystem } from "../storage/indexedDbFileSystem";

/**
 * @returns the IndexedDB path of a paper's sidecar.
 */
export function sidecarPath(paperId: string): string {
  return `${APPDATA_DIR}/${paperId}/${SIDECAR_FILE}`;
}

/**
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
