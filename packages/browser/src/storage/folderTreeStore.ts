/**
 * Derives the folder tree from the "files" IndexedDB store on demand. No
 * separate store is maintained — all queries scan path keys directly. Suitable
 * for the library page tree view where the tree changes only after a sync
 * cycle or a folder mutation.
 *
 * Mirrors the VS Code extension's `readCollectionFolders`: a directory that
 * holds a paper (marker file `metadata.yaml` or `paper.pdf`) is a paper, not a
 * collection, and never appears in the tree. Dot-directories are hidden.
 * @depends idb/db
 * @dependents library-page controllers, storage/index
 */
import { getDb } from "./idb/db";

export interface FolderNode {
  name: string;
  path: string;
  children: FolderNode[];
}

const PAPER_MARKERS = new Set(["metadata.yaml", "paper.pdf"]);

// What every paper's PDF is called inside its folder (same as core's LIBRARY_PDF_NAME).
const PAPER_PDF = "paper.pdf";

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

/**
 * Builds the collection tree under `rootPath` from a single key scan.
 * @usedBy library-page controllers/dataController
 */
export async function buildFolderTree(rootPath: string = "papers"): Promise<FolderNode[]> {
  const db = await getDb();
  const prefix = `${rootPath}/`;
  const keys = (await db.getAllKeys("files", IDBKeyRange.bound(prefix, `${prefix}￿`, false, true))) as string[];
  return collectionTreeFromKeys(keys, rootPath);
}

/**
 * Pure tree builder shared with tests: every ancestor directory of a file key
 * becomes a node unless it is a paper folder or a dot-directory.
 */
export function collectionTreeFromKeys(keys: string[], rootPath: string): FolderNode[] {
  const paperDirs = new Set<string>();
  const dirs = new Set<string>();
  for (const key of keys) {
    const parts = key.split("/");
    const file = parts[parts.length - 1] ?? "";
    if (parts.length > 1 && PAPER_MARKERS.has(file)) paperDirs.add(parts.slice(0, -1).join("/"));
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
  }

  const isPaperOrHidden = (dir: string): boolean =>
    paperDirs.has(dir) || dir.split("/").some((seg, i) => i > 0 && seg.startsWith("."));

  const build = (dir: string): FolderNode[] =>
    [...dirs]
      .filter((d) => d.startsWith(`${dir}/`) && !d.slice(dir.length + 1).includes("/") && !isPaperOrHidden(d))
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
      .map((path) => ({ name: path.slice(dir.length + 1), path, children: build(path) }));

  return build(rootPath);
}

/**
 * Pure: paper folders (record.path) that hold a paper.pdf. Conflict copies
 * ("paper (conflict 2026-05-22).pdf") and backups ("paper.pdf.bak") don't
 * count — only an exact "paper.pdf" basename marks a present PDF.
 * @usedBy scanLibrary, pdfDirs, tests
 */
export function pdfDirsFromKeys(keys: string[]): Set<string> {
  const out = new Set<string>();
  const suffix = `/${PAPER_PDF}`;
  for (const key of keys) {
    if (key.endsWith(suffix)) out.add(key.slice(0, -suffix.length));
  }
  return out;
}

/**
 * One key scan feeding both the collection tree and the PDF-presence set, so
 * the library page's load and refresh cost a single IndexedDB round trip.
 * @usedBy library-page controllers/dataController
 */
export async function scanLibrary(rootPath: string = "papers"): Promise<{ tree: FolderNode[]; pdfDirs: Set<string> }> {
  const db = await getDb();
  const prefix = `${rootPath}/`;
  const keys = (await db.getAllKeys("files", IDBKeyRange.bound(prefix, `${prefix}￿`, false, true))) as string[];
  return { tree: collectionTreeFromKeys(keys, rootPath), pdfDirs: pdfDirsFromKeys(keys) };
}

/**
 * The folders holding a paper.pdf, for the background's library.lookup /
 * draftView (which do not need the tree).
 * @usedBy background/index
 */
export async function pdfDirs(rootPath: string = "papers"): Promise<Set<string>> {
  const db = await getDb();
  const prefix = `${rootPath}/`;
  const keys = (await db.getAllKeys("files", IDBKeyRange.bound(prefix, `${prefix}￿`, false, true))) as string[];
  return pdfDirsFromKeys(keys);
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
