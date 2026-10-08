/**
 * Pure derivations for the library page — the browser counterpart of the
 * VS Code extension's `ui/library/folderNavigation.ts`, with "/"-separated
 * IndexedDB paths instead of absolute file paths. Everything here is
 * side-effect free so the views stay thin and the logic is unit-testable.
 *
 * @depends @labshelf/core PaperRecord, storage FolderNode
 * @dependents library-page views and controllers
 */
import { PAPER_STATUSES, type PaperRecord, type PaperStatus, PAPERS_DIR } from "@labshelf/core";
import type { FolderNode } from "../../storage";
import type { SortDir, SortKey, StatusFilter } from "./libraryStore";

export const ROOT = PAPERS_DIR;
export const ROOT_LABEL = "All Papers";
export const STATUSES: readonly PaperStatus[] = PAPER_STATUSES;
export const STATUS_LABEL: Record<PaperStatus, string> = { unread: "Unread", reading: "Reading", done: "Done" };
const STATUS_ORDER: Record<PaperStatus, number> = { unread: 0, reading: 1, done: 2 };

export interface Crumb { label: string; path: string; isRoot: boolean }
export interface SubfolderEntry { label: string; path: string; count: number }

/** A paper as the list sees it: the record plus where it sits relative to the open folder. */
export interface ListPaper extends PaperRecord {
  /** Folder holding the paper (parent of `path`). */
  folderPath: string;
  /** Holder folder relative to the open folder, " / "-joined; empty when directly inside. */
  relFolder: string;
  /** Lower-cased haystack for token search. */
  hay: string;
  /** Whether `${path}/paper.pdf` exists on this device (from the store's pdfDirs). */
  hasPdf: boolean;
}

/** Shared empty set so callers that do not track PDF presence (counts) need not build one. */
const NO_PDF_DIRS: ReadonlySet<string> = new Set();

export function isUnder(p: string, dir: string): boolean {
  return p === dir || p.startsWith(`${dir}/`);
}

export function parentDir(p: string): string {
  const i = p.lastIndexOf("/");
  return i <= 0 ? p : p.slice(0, i);
}

export function baseName(p: string): string {
  return p.slice(p.lastIndexOf("/") + 1);
}

export function folderLabel(path: string): string {
  return path === ROOT || path === "" ? ROOT_LABEL : baseName(path);
}

/** Root-first chain of folders from papers/ down to `path`; just the root when `path` is outside it. */
export function breadcrumbFor(path: string): Crumb[] {
  const chain: Crumb[] = [{ label: ROOT_LABEL, path: ROOT, isRoot: true }];
  if (!isUnder(path, ROOT) || path === ROOT) return chain;
  let current = ROOT;
  for (const seg of path.slice(ROOT.length + 1).split("/")) {
    current = `${current}/${seg}`;
    chain.push({ label: seg, path: current, isRoot: false });
  }
  return chain;
}

/** Finds a node in the tree by path; the root is represented by the tree itself. */
export function findNode(tree: FolderNode[], path: string): FolderNode | undefined {
  for (const node of tree) {
    if (node.path === path) return node;
    if (isUnder(path, node.path)) return findNode(node.children, path);
  }
  return undefined;
}

/** Direct child collections of `folder` with recursive paper counts, sorted by name. */
export function subfoldersOf(tree: FolderNode[], folder: string, paperPaths: string[]): SubfolderEntry[] {
  const children = folder === ROOT ? tree : findNode(tree, folder)?.children ?? [];
  return children.map((c) => ({ label: c.name, path: c.path, count: countPapersUnder(paperPaths, c.path) }));
}

/** Number of papers stored at any depth under `dir`. */
export function countPapersUnder(paperPaths: string[], dir: string): number {
  let n = 0;
  for (const p of paperPaths) if (isUnder(p, dir)) n++;
  return n;
}

/** Every folder path in the tree, parents before children, root first. */
export function flattenFolders(tree: FolderNode[]): Array<{ label: string; path: string }> {
  const out: Array<{ label: string; path: string }> = [];
  const walk = (nodes: FolderNode[]): void => {
    for (const n of nodes) { out.push({ label: n.path.slice(ROOT.length + 1).split("/").join(" / "), path: n.path }); walk(n.children); }
  };
  walk(tree);
  return out;
}

/**
 * The papers stored under `folder`, decorated for the list. `pdfDirs` carries
 * the record paths whose folder holds a paper.pdf (the store's slice); it
 * defaults to empty for callers that only count papers and ignore presence.
 */
export function listPapersUnder(all: PaperRecord[], folder: string, pdfDirs: ReadonlySet<string> = NO_PDF_DIRS): ListPaper[] {
  return all
    .filter((p) => isUnder(p.path, folder) && p.path !== folder)
    .map((p) => {
      const folderPath = parentDir(p.path);
      const relFolder = folderPath === folder || !isUnder(folderPath, folder)
        ? ""
        : folderPath.slice(folder.length + 1).split("/").join(" / ");
      const hay = [p.title, (p.authors ?? []).join(" "), p.year, p.citeKey, p.journal, p.publisher, (p.keywords ?? []).join(" "), relFolder]
        .join(" ").toLowerCase();
      return { ...p, folderPath, relFolder, hay, hasPdf: pdfDirs.has(p.path) };
    });
}

/**
 * Papers in scope before the status tab is applied, so each tab can show its
 * own count. A search always covers the whole subtree; without one the
 * subfolder toggle decides.
 */
export function papersInScope(papers: ListPaper[], tokens: string[], includeSub: boolean): ListPaper[] {
  return papers.filter((p) => tokens.length ? tokens.every((t) => p.hay.includes(t)) : includeSub || p.relFolder === "");
}

export function statusCounts(scope: ListPaper[]): Record<StatusFilter, number> {
  const counts: Record<StatusFilter, number> = { all: scope.length, unread: 0, reading: 0, done: 0 };
  for (const p of scope) counts[p.status]++;
  return counts;
}

export function lastName(author: string): string {
  return author.trim().split(" ").pop() ?? author;
}

/** "Smith", "Smith, Lee" or "Smith et al." — the Creator column. */
export function fmtCreator(authors: string[] | undefined): string {
  if (!authors || authors.length === 0) return "";
  if (authors.length === 1) return authors[0]!;
  return authors.length > 2 ? `${lastName(authors[0]!)} et al.` : authors.map(lastName).join(", ");
}

export function nextStatus(status: PaperStatus): PaperStatus {
  return STATUSES[(STATUSES.indexOf(status) + 1) % STATUSES.length]!;
}

/** Stable sort by the chosen column with title as the tiebreaker. Returns a new array. */
export function sortPapers(papers: ListPaper[], key: SortKey, dir: SortDir): ListPaper[] {
  const val = (p: ListPaper): string | number => {
    if (key === "creator") return fmtCreator(p.authors).toLowerCase();
    if (key === "year") return p.year ?? 0;
    if (key === "status") return STATUS_ORDER[p.status] ?? 0;
    if (key === "publication") return (p.journal ?? p.publisher ?? "").toLowerCase();
    return (p.title ?? "").toLowerCase();
  };
  return [...papers].sort((a, b) => {
    const x = val(a);
    const y = val(b);
    if (x < y) return -dir;
    if (x > y) return dir;
    return (a.title ?? "").localeCompare(b.title ?? "");
  });
}
