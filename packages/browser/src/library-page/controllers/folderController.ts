/**
 * Reacts to folder intents from the tree and header (new, rename, delete) through the core library mutations.
 * Prompts use the in-page input box and dialog; sync runs separately and is only asked to run soon.
 */
import { validateFolderName } from "@labshelf/core";
import { BrowserLogger } from "../../platform/logger";
import { createLibraryMutations } from "../../storage";
import { confirmDialog } from "../../ui/dialog";
import { inputBox } from "../../ui/quickInput";
import { toast } from "../../ui/toast";
import { on } from "../events";
import { ROOT, baseName, countPapersUnder, findNode, isUnder, parentDir } from "../state/derive";
import type { LibraryStore } from "../state/libraryStore";
import { errorMessage, refreshLibrary, scheduleSyncSoon } from "./dataController";

const mutations = createLibraryMutations(new BrowserLogger("library-page"));

/** Attaches listeners that mutate IDB in response to folder intents. Returns a disposer. */
export function attachFolderController(store: LibraryStore): () => void {
  const offs = [
    on("labshelf:new-folder", ({ parent }) => { void guard(store, () => handleNew(store, parent)); }),
    on("labshelf:rename-folder", ({ path }) => { void guard(store, () => handleRename(store, path)); }),
    on("labshelf:delete-folder", ({ path }) => { void guard(store, () => handleDelete(store, path)); }),
  ];
  return () => offs.forEach((off) => off());
}

async function guard(_store: LibraryStore, work: () => Promise<void>): Promise<void> {
  try { await work(); } catch (err) { toast(errorMessage(err), "error"); }
}

/** Validation shared by new and rename: the core name rule plus sibling collision. */
export function folderNameProblem(store: LibraryStore, parent: string, name: string, current?: string): string | null {
  const invalid = validateFolderName(name);
  if (invalid) return invalid;
  const trimmed = name.trim();
  if (trimmed === current) return null;
  const siblings = parent === ROOT ? store.get().folders : findNode(store.get().folders, parent)?.children ?? [];
  if (siblings.some((s) => s.name.toLowerCase() === trimmed.toLowerCase())) return `A folder named "${trimmed}" already exists here.`;
  if (store.get().papers.some((p) => p.path === `${parent}/${trimmed}`)) return "A paper already uses that name here.";
  return null;
}

async function handleNew(store: LibraryStore, parent: string): Promise<void> {
  const name = await inputBox({
    title: parent === ROOT ? "New folder" : `New folder in ${baseName(parent)}`,
    prompt: "Folder name",
    placeholder: "e.g. Reading group",
    validate: (v) => folderNameProblem(store, parent, v),
  });
  if (!name) return;
  const target = await mutations.createFolder(parent, name);
  await refreshLibrary(store);
  store.openFolder(target);
  scheduleSyncSoon("folder.new");
}

async function handleRename(store: LibraryStore, oldPath: string): Promise<void> {
  if (oldPath === ROOT) return;
  const current = baseName(oldPath);
  const parent = parentDir(oldPath);
  const next = await inputBox({
    title: "Rename folder",
    prompt: "New name",
    value: current,
    validate: (v) => folderNameProblem(store, parent, v, current),
  });
  if (!next || next === current) return;
  const newPath = await mutations.renameFolder(oldPath, next);
  await refreshLibrary(store);
  const open = store.get().folder;
  if (isUnder(open, oldPath)) store.openFolder(newPath + open.slice(oldPath.length));
  scheduleSyncSoon("folder.rename");
}

async function handleDelete(store: LibraryStore, path: string): Promise<void> {
  if (path === ROOT) return;
  const count = countPapersUnder(store.get().papers.map((p) => p.path), path);
  const ok = await confirmDialog(
    `Delete "${baseName(path)}"?`,
    count > 0
      ? `The folder and the ${count} paper${count === 1 ? "" : "s"} inside it will be removed from this library. The next sync removes them from Google Drive too.`
      : "The folder is empty. It will be removed from this library and from Google Drive on the next sync.",
    "Delete",
    true,
  );
  if (!ok) return;
  await mutations.trashFolder(path);
  await refreshLibrary(store);
  if (isUnder(store.get().folder, path)) store.openFolder(parentDir(path));
  scheduleSyncSoon("folder.delete");
  toast(`Deleted ${baseName(path)}`, "ok");
}
