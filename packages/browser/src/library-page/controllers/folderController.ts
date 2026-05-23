/**
 * Reacts to folder CustomEvents emitted by the tree view (new / rename /
 * delete) by mutating the IndexedDB file store and the paper-record cache.
 * Folder paths are virtual in IDB — a folder exists iff at least one file row
 * starts with its prefix — so "new folder" writes a `.keep` sentinel and
 * "rename" walks all rows under the old prefix.
 *
 * Sync runs separately: every mutation here just changes the local IDB state.
 * The next sync (manual or scheduled) picks it up and propagates to Drive.
 *
 * @depends @labshelf/core FolderService, storage (IndexedDbFileSystem,
 *          paperRecordStore), controllers/dataController
 * @dependents library-page/index
 */
import { FolderService } from "@labshelf/core";
import type { IPaperRecordIndex } from "@labshelf/core";
import {
  IndexedDbFileSystem,
  deleteRecord,
  listAllRecords,
  upsertRecord,
} from "../../storage";
import type { LibraryStore } from "../state/libraryStore";
import { refreshFolders, refreshPapersSlice } from "./dataController";

const fs = new IndexedDbFileSystem();

// Adapter from paperRecordStore free functions to the IPaperRecordIndex
// surface FolderService expects.
const paperIndex: IPaperRecordIndex = {
  listPapers: () => listAllRecords(),
  upsertPaper: (p) => upsertRecord(p, p.path),
  deletePaper: (id) => deleteRecord(id),
};
const folderService = new FolderService(paperIndex, "/");

function isValidName(name: string): boolean {
  return /^[^/\\]+$/.test(name.trim()) && name.trim() !== "." && name.trim() !== "..";
}

/** Attaches listeners that mutate IDB in response to tree-view actions. */
export function attachFolderController(store: LibraryStore): void {
  document.addEventListener("labshelf:new-folder", (e: Event) => {
    const { parent } = (e as CustomEvent<{ parent: string }>).detail;
    void handleNew(store, parent);
  });
  document.addEventListener("labshelf:rename-folder", (e: Event) => {
    const { path } = (e as CustomEvent<{ path: string }>).detail;
    void handleRename(store, path);
  });
  document.addEventListener("labshelf:delete-folder", (e: Event) => {
    const { path } = (e as CustomEvent<{ path: string }>).detail;
    void handleDelete(store, path);
  });
}

async function handleNew(store: LibraryStore, parent: string): Promise<void> {
  const name = window.prompt("New folder name");
  if (!name) return;
  if (!isValidName(name)) {
    store.set({ error: "Folder name must not contain slashes." });
    return;
  }
  const target = `${parent}/${name.trim()}`;
  await fs.writeFile(`${target}/.keep`, new Uint8Array());
  await refreshFolders(store);
  store.set({ selectedFolder: target });
}

async function handleRename(store: LibraryStore, oldPath: string): Promise<void> {
  if (oldPath === "papers") return;
  const current = oldPath.split("/").pop() ?? "";
  const next = window.prompt("Rename folder", current);
  if (!next || next.trim() === current) return;
  if (!isValidName(next)) {
    store.set({ error: "Folder name must not contain slashes." });
    return;
  }
  const parent = oldPath.split("/").slice(0, -1).join("/");
  const newPath = `${parent}/${next.trim()}`;
  await fs.moveDir(oldPath, newPath);
  await folderService.relocatePapersUnder(oldPath, newPath);
  await Promise.all([refreshFolders(store), refreshPapersSlice(store)]);
  if (store.get().selectedFolder.startsWith(oldPath)) {
    store.set({ selectedFolder: newPath });
  }
}

async function handleDelete(store: LibraryStore, path: string): Promise<void> {
  if (path === "papers") return;
  if (!window.confirm(`Delete folder "${path}" and every paper inside it?`)) return;
  await folderService.removePapersUnder(path);
  await fs.deleteDir(path);
  await Promise.all([refreshFolders(store), refreshPapersSlice(store)]);
  if (store.get().selectedFolder === path) {
    store.set({ selectedFolder: "papers", selectedPaperId: null });
  }
}
