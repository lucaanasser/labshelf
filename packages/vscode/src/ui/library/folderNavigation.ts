/**
 * Pure folder-navigation helpers shared by the library tree and the list panel: breadcrumbs, recursive paper counts, and the state payload the panel renders.
 *
 * @depends @labshelf/core
 * @dependents ui/library/libraryTreeDataProvider.ts, ui/library/collectionFolders.ts, ui/list/listWebviewPanel.ts
 */
import { isUnderDir } from '@labshelf/core';
import type { PaperRecord } from '@labshelf/core';

// A node is a "collection folder": a real directory under papers/ that is not
// itself a paper folder. The root node stands for papers/ itself.
export interface LibraryNode {
  label: string;
  dirPath: string;
  isRoot?: boolean;
}

export const ROOT_LABEL = 'All Papers';

export interface SubfolderEntry extends LibraryNode {
  count: number;
}

// A paper as the list panel sees it: the record plus where it sits relative to the open folder.
export interface ListPaper extends PaperRecord {
  folderPath: string;
  relFolder: string;
}

// Every paper in the library, trimmed to what the detail pane needs to find related papers outside the open folder.
export interface LibraryPaper {
  id: string;
  title: string;
  authors?: string[];
  year?: number;
  journal?: string;
  publisher?: string;
  keywords?: string[];
  tags?: string[];
  status: PaperRecord['status'];
  folderPath: string;
}

// What the reader's sidecar says about a paper: annotation count and the last reading position.
export interface PaperStats {
  annotations: number;
  lastPage?: number;
  lastRead?: string;
}

export interface ListPanelState {
  type: 'state';
  folder: LibraryNode;
  breadcrumb: LibraryNode[];
  subfolders: SubfolderEntry[];
  papers: ListPaper[];
  library: LibraryPaper[];
  stats?: Record<string, PaperStats>;
}

/** Builds the node that represents papers/ itself. */
export function rootNode(rootDir: string): LibraryNode {
  return { label: ROOT_LABEL, dirPath: rootDir, isRoot: true };
}

/** Parent directory of `p`, computed with an explicit separator so it is testable on any platform. */
export function parentDir(p: string, sep: string): string {
  const idx = p.lastIndexOf(sep);
  return idx <= 0 ? p : p.slice(0, idx);
}

/** Root-first chain of folders from papers/ down to `dirPath`; just the root when `dirPath` is outside it. */
export function breadcrumbFor(rootDir: string, dirPath: string, sep: string): LibraryNode[] {
  const chain: LibraryNode[] = [rootNode(rootDir)];
  if (dirPath === rootDir || !isUnderDir(dirPath, rootDir, sep)) {
    return chain;
  }
  let current = rootDir;
  for (const segment of dirPath.slice(rootDir.length + sep.length).split(sep)) {
    current = current + sep + segment;
    chain.push({ label: segment, dirPath: current });
  }
  return chain;
}

/** Number of papers stored at any depth under `dirPath`. */
export function countPapersUnder(paperPaths: string[], dirPath: string, sep: string): number {
  let count = 0;
  for (const p of paperPaths) {
    if (isUnderDir(p, dirPath, sep)) { count++; }
  }
  return count;
}

/** Folder that holds the paper, relative to `dirPath`; empty when the paper sits directly in it. */
export function relativeFolder(paperPath: string, dirPath: string, sep: string): string {
  const holder = parentDir(paperPath, sep);
  if (holder === dirPath || !isUnderDir(holder, dirPath, sep)) {
    return '';
  }
  return holder.slice(dirPath.length + sep.length).split(sep).join(' / ');
}

/** Assembles everything the list panel needs to render `folder`. */
export function buildListState(
  allPapers: PaperRecord[],
  folder: LibraryNode,
  rootDir: string,
  subfolders: LibraryNode[],
  sep: string,
): ListPanelState {
  const paths = allPapers.map((p) => p.path);
  const papers = allPapers
    .filter((p) => isUnderDir(p.path, folder.dirPath, sep))
    .map((p) => ({
      ...p,
      folderPath: parentDir(p.path, sep),
      relFolder: relativeFolder(p.path, folder.dirPath, sep),
    }));

  return {
    type: 'state',
    folder,
    breadcrumb: breadcrumbFor(rootDir, folder.dirPath, sep),
    subfolders: subfolders.map((s) => ({ ...s, count: countPapersUnder(paths, s.dirPath, sep) })),
    papers,
    library: allPapers.map((p) => ({
      id: p.id,
      title: p.title,
      status: p.status,
      folderPath: parentDir(p.path, sep),
      ...(p.authors ? { authors: p.authors } : {}),
      ...(p.year ? { year: p.year } : {}),
      ...(p.journal ? { journal: p.journal } : {}),
      ...(p.publisher ? { publisher: p.publisher } : {}),
      ...(p.keywords ? { keywords: p.keywords } : {}),
      ...(p.tags ? { tags: p.tags } : {}),
    })),
  };
}
