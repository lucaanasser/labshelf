/**
 * Reads the whole library from disk into an immutable snapshot: every paper (from its metadata.yaml) and the tree of
 * collections. Files are the source of truth here, exactly as for the VS Code indexer, which rebuilds its SQLite cache
 * from the same files; so both apps always agree on what the library contains.
 *
 * Folder rules (same as VS Code's tree and indexer): a folder holding metadata.yaml is a paper; a folder holding only
 * paper.pdf is neither a paper nor a collection (VS Code does not index it either); dot-folders are hidden; anything
 * else under papers/ is a collection.
 *
 * @depends @labshelf/core (paperRecordFromMetadata), library/libraryRoot
 * @dependents library/libraryStore, cli/commands
 */
import { promises as fs, type Dirent } from "node:fs";
import * as path from "node:path";

import { METADATA_FILE, PDF_FILE, paperRecordFromMetadata, parsePaperMetadata, type PaperRecord } from "@labshelf/core";

import type { LibraryRoot } from "./libraryRoot.js";

export interface PaperEntry {
  record: PaperRecord;
  /** Collection path relative to papers/ ("" for the root). */
  collection: string;
  /** mtime of metadata.yaml, used for the "modified" sort. */
  modifiedMs: number;
  pdfBytes?: number;
}

export interface CollectionNode {
  /** Path relative to papers/, "/"-separated; "" is the library root. */
  rel: string;
  name: string;
  parent: string | undefined;
  children: string[];
  /** Papers directly inside this collection. */
  paperIds: string[];
  /** Papers in this collection and every collection below it. */
  total: number;
}

export interface LibrarySnapshot {
  root: string;
  papers: ReadonlyMap<string, PaperEntry>;
  collections: ReadonlyMap<string, CollectionNode>;
  /** Paper folders whose id was already taken by another folder (kept out of the snapshot). */
  duplicates: string[];
  /** Folders with a paper.pdf but no metadata.yaml. */
  orphans: string[];
  scannedAt: number;
}

const MAX_PARALLEL_READS = 32;

// Small promise pool so a large library does not open thousands of files at once.
function limiter(max: number): <T>(task: () => Promise<T>) => Promise<T> {
  let running = 0;
  const queue: Array<() => void> = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (running >= max) { await new Promise<void>((resolve) => queue.push(resolve)); }
    running++;
    try {
      return await task();
    } finally {
      running--;
      queue.shift()?.();
    }
  };
}

async function isFileEntry(dir: string, entry: Dirent): Promise<boolean> {
  if (entry.isFile()) { return true; }
  if (!entry.isSymbolicLink()) { return false; }
  try {
    return (await fs.stat(path.join(dir, entry.name))).isFile();
  } catch {
    return false;
  }
}

/**
 * Reads one paper folder.
 * @usedBy scanLibrary, library/paperService (fresh read before a write)
 * @returns the entry, or undefined when metadata.yaml is missing or not a mapping
 */
export async function readPaperFolder(paths: LibraryRoot, folder: string): Promise<PaperEntry | undefined> {
  const metadataPath = path.join(folder, METADATA_FILE);
  let text: string;
  let modifiedMs: number;
  try {
    const [content, stat] = await Promise.all([fs.readFile(metadataPath, "utf8"), fs.stat(metadataPath)]);
    text = content;
    modifiedMs = stat.mtimeMs;
  } catch {
    return undefined;
  }
  const meta = parsePaperMetadata(text);
  if (!meta) { return undefined; }
  let pdfBytes: number | undefined;
  try {
    const pdf = await fs.stat(path.join(folder, PDF_FILE));
    if (pdf.isFile()) { pdfBytes = pdf.size; }
  } catch {
    pdfBytes = undefined;
  }
  const record = paperRecordFromMetadata(meta, { id: path.basename(folder), path: folder, hasPdf: pdfBytes !== undefined });
  return {
    record,
    collection: paths.relativeCollection(path.dirname(folder)),
    modifiedMs,
    ...(pdfBytes !== undefined ? { pdfBytes } : {}),
  };
}

/**
 * Scans papers/ completely.
 * @usedBy library/libraryStore, cli/commands
 * @returns the snapshot
 */
export async function scanLibrary(paths: LibraryRoot): Promise<LibrarySnapshot> {
  const limit = limiter(MAX_PARALLEL_READS);
  const papers = new Map<string, PaperEntry>();
  const collections = new Map<string, CollectionNode>();
  const duplicates: string[] = [];
  const orphans: string[] = [];
  const found: Array<{ folder: string; entry: PaperEntry | undefined }> = [];

  collections.set("", { rel: "", name: "papers", parent: undefined, children: [], paperIds: [], total: 0 });

  async function walk(dir: string, rel: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await limit(() => fs.readdir(dir, { withFileTypes: true }));
    } catch {
      return;
    }
    const subdirs: Dirent[] = [];
    for (const entry of entries) {
      if (entry.name.startsWith(".")) { continue; }
      if (entry.isDirectory()) { subdirs.push(entry); }
    }
    await Promise.all(subdirs.map(async (sub) => {
      const childDir = path.join(dir, sub.name);
      let childEntries: Dirent[];
      try {
        childEntries = await limit(() => fs.readdir(childDir, { withFileTypes: true }));
      } catch {
        return;
      }
      const hasMetadata = await anyFile(childDir, childEntries, METADATA_FILE);
      if (hasMetadata) {
        found.push({ folder: childDir, entry: await limit(() => readPaperFolder(paths, childDir)) });
        return;
      }
      if (await anyFile(childDir, childEntries, PDF_FILE)) {
        orphans.push(childDir);
        return;
      }
      const childRel = rel ? `${rel}/${sub.name}` : sub.name;
      collections.set(childRel, { rel: childRel, name: sub.name, parent: rel, children: [], paperIds: [], total: 0 });
      await walk(childDir, childRel);
    }));
  }

  await walk(paths.layout.papersRoot(), "");

  // Deterministic winner for duplicate ids: the first folder in path order.
  found.sort((a, b) => a.folder.localeCompare(b.folder));
  for (const { folder, entry } of found) {
    if (!entry) { continue; }
    if (papers.has(entry.record.id)) {
      duplicates.push(folder);
      continue;
    }
    papers.set(entry.record.id, entry);
  }

  for (const node of collections.values()) {
    if (node.parent !== undefined) { collections.get(node.parent)?.children.push(node.rel); }
  }
  for (const node of collections.values()) {
    node.children.sort((a, b) => collator.compare(collections.get(a)!.name, collections.get(b)!.name));
  }
  for (const entry of papers.values()) {
    collections.get(entry.collection)?.paperIds.push(entry.record.id);
    // Count the paper in its collection and every ancestor.
    let rel: string | undefined = entry.collection;
    while (rel !== undefined) {
      const node = collections.get(rel);
      if (!node) { break; }
      node.total++;
      rel = node.parent;
    }
  }

  return { root: paths.root, papers, collections, duplicates, orphans: orphans.sort(), scannedAt: Date.now() };
}

async function anyFile(dir: string, entries: Dirent[], name: string): Promise<boolean> {
  const entry = entries.find((e) => e.name === name);
  return entry ? isFileEntry(dir, entry) : false;
}

export const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/**
 * All papers at or below a collection.
 * @usedBy library/libraryStore, cli bib
 * @returns the entries
 */
export function papersUnder(snapshot: LibrarySnapshot, rel: string): PaperEntry[] {
  if (!rel) { return [...snapshot.papers.values()]; }
  const prefix = rel + "/";
  return [...snapshot.papers.values()].filter((e) => e.collection === rel || e.collection.startsWith(prefix));
}
