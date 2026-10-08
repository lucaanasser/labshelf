/**
 * The in-memory view of the library the TUI and CLI read from: the latest snapshot, the listing of a collection
 * (sub-collections first, then papers, sorted), library-wide search, and change notification. Reloads are coalesced,
 * so a burst of file events (a sync pulling twenty papers, VS Code rewriting metadata) costs one rescan.
 *
 * @depends library/libraryScanner, library/search, library/sidecars
 * @dependents app/context, ui/app, cli/commands
 */
import type { PaperRecord } from "@labshelf/core";

import { LibraryRoot } from "./libraryRoot.js";
import {
  collator,
  papersUnder,
  scanLibrary,
  type CollectionNode,
  type LibrarySnapshot,
  type PaperEntry,
} from "./libraryScanner.js";
import { isEmptyQuery, matchPaper, parseQuery, searchDoc, type SearchDoc } from "./search.js";
import type { SortKey } from "../app/config.js";
import { fold } from "../tui/text.js";

export type Entry =
  | { kind: "collection"; node: CollectionNode }
  | { kind: "paper"; paper: PaperEntry };

export interface SortSpec {
  key: SortKey;
  reverse: boolean;
}

export interface ListOptions {
  sort: SortSpec;
  /** Show every paper below the collection, without sub-collections. */
  flatten?: boolean;
  /** Query-language filter applied to papers (collections stay when their name matches). */
  filter?: string;
}

const STATUS_ORDER: Record<PaperRecord["status"], number> = { reading: 0, unread: 1, done: 2 };

function firstAuthorKey(record: PaperRecord): string {
  const first = record.authors?.[0] ?? "";
  // "Vaswani, Ashish" and "Ashish Vaswani" both sort under Vaswani.
  const family = first.includes(",") ? first.split(",")[0]! : first.split(/\s+/).pop() ?? "";
  return family.toLowerCase();
}

/**
 * Comparator for papers under a sort spec; ties fall back to the title.
 * @usedBy listCollection, search
 * @returns the comparator
 */
export function paperComparator(sort: SortSpec): (a: PaperEntry, b: PaperEntry) => number {
  const byTitle = (a: PaperEntry, b: PaperEntry): number => collator.compare(a.record.title, b.record.title);
  let primary: (a: PaperEntry, b: PaperEntry) => number;
  switch (sort.key) {
    case "year":
      // Newest first reads naturally for years; reverse flips it.
      primary = (a, b) => (b.record.year ?? -Infinity) - (a.record.year ?? -Infinity);
      break;
    case "author":
      primary = (a, b) => collator.compare(firstAuthorKey(a.record), firstAuthorKey(b.record));
      break;
    case "status":
      primary = (a, b) => STATUS_ORDER[a.record.status] - STATUS_ORDER[b.record.status];
      break;
    case "modified":
      primary = (a, b) => b.modifiedMs - a.modifiedMs;
      break;
    default:
      primary = () => 0;
  }
  const sign = sort.reverse ? -1 : 1;
  return (a, b) => sign * (primary(a, b) || byTitle(a, b));
}

type Listener = (snapshot: LibrarySnapshot) => void;

export class LibraryStore {
  private current: LibrarySnapshot;
  private readonly listeners = new Set<Listener>();
  private readonly docs = new Map<string, { record: PaperRecord; extra: string; doc: SearchDoc }>();
  private annotationText = new Map<string, string>();
  private reloading: Promise<LibrarySnapshot> | undefined;
  private reloadAgain = false;

  constructor(readonly paths: LibraryRoot, initial?: LibrarySnapshot) {
    this.current = initial ?? {
      root: paths.root,
      papers: new Map(),
      collections: new Map([["", { rel: "", name: "papers", parent: undefined, children: [], paperIds: [], total: 0 }]]),
      duplicates: [],
      orphans: [],
      scannedAt: 0,
    };
  }

  /** @returns the latest snapshot */
  get snapshot(): LibrarySnapshot {
    return this.current;
  }

  /**
   * Subscribes to snapshot changes.
   * @usedBy ui/app
   * @returns an unsubscribe function
   */
  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Rescans the library. Calls made while a scan runs are folded into one follow-up scan.
   * @usedBy app/context, library/libraryWatcher, library/paperService, sync/syncService
   * @returns the new snapshot
   */
  async reload(): Promise<LibrarySnapshot> {
    if (this.reloading) {
      this.reloadAgain = true;
      return this.reloading;
    }
    this.reloading = (async () => {
      let snapshot: LibrarySnapshot;
      do {
        this.reloadAgain = false;
        snapshot = await scanLibrary(this.paths);
      } while (this.reloadAgain);
      this.current = snapshot;
      for (const listener of this.listeners) { listener(snapshot); }
      return snapshot;
    })();
    try {
      return await this.reloading;
    } finally {
      this.reloading = undefined;
    }
  }

  /**
   * Annotation text per paper, folded into the library search so a highlight finds its paper.
   * @usedBy app/context (after loading sidecars)
   * @returns void
   */
  setAnnotationText(text: Map<string, string>): void {
    this.annotationText = text;
  }

  /** @returns the paper with this id in the latest snapshot */
  paper(id: string): PaperEntry | undefined {
    return this.current.papers.get(id);
  }

  /** @returns the collection at this path in the latest snapshot */
  collection(rel: string): CollectionNode | undefined {
    return this.current.collections.get(rel);
  }

  private doc(entry: PaperEntry): SearchDoc {
    const extra = this.annotationText.get(entry.record.id) ?? "";
    const cached = this.docs.get(entry.record.id);
    if (cached && cached.record === entry.record && cached.extra === extra) { return cached.doc; }
    const doc = searchDoc(entry.record, extra);
    this.docs.set(entry.record.id, { record: entry.record, extra, doc });
    return doc;
  }

  /**
   * The entries of one collection as the middle column shows them.
   * @usedBy ui/app, cli ls
   * @returns sub-collections (by name) then papers (by the sort spec)
   */
  listCollection(rel: string, options: ListOptions): Entry[] {
    const node = this.current.collections.get(rel);
    if (!node) { return []; }
    const query = parseQuery(options.filter ?? "");
    const filtering = !isEmptyQuery(query);
    const entries: Entry[] = [];
    if (!options.flatten) {
      for (const childRel of node.children) {
        const child = this.current.collections.get(childRel);
        if (!child) { continue; }
        if (filtering && !query.terms.every((t) => fold(child.name).includes(t))) { continue; }
        entries.push({ kind: "collection", node: child });
      }
    }
    const papers = options.flatten
      ? papersUnder(this.current, rel)
      : node.paperIds.map((id) => this.current.papers.get(id)).filter((p): p is PaperEntry => Boolean(p));
    const kept = filtering ? papers.filter((p) => matchPaper(p.record, this.doc(p), query) > 0) : papers;
    kept.sort(paperComparator(options.sort));
    for (const paper of kept) { entries.push({ kind: "paper", paper }); }
    return entries;
  }

  /**
   * Searches every paper in the library.
   * @usedBy ui/app (s), cli search
   * @returns matching papers, best match first (ties by the sort spec)
   */
  search(query: string, sort: SortSpec): PaperEntry[] {
    const parsed = parseQuery(query);
    const all = [...this.current.papers.values()];
    if (isEmptyQuery(parsed)) { return all.sort(paperComparator(sort)); }
    const compare = paperComparator(sort);
    return all
      .map((paper) => ({ paper, score: matchPaper(paper.record, this.doc(paper), parsed) }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score || compare(a.paper, b.paper))
      .map((r) => r.paper);
  }

  /**
   * Every tag in use with its count, most used first.
   * @usedBy ui/app (tag prompt completion)
   * @returns the tags
   */
  tagCounts(): Array<{ tag: string; count: number }> {
    const counts = new Map<string, { tag: string; count: number }>();
    for (const { record } of this.current.papers.values()) {
      for (const tag of record.tags ?? []) {
        const key = tag.toLowerCase();
        const entry = counts.get(key) ?? { tag, count: 0 };
        entry.count++;
        counts.set(key, entry);
      }
    }
    return [...counts.values()].sort((a, b) => b.count - a.count || collator.compare(a.tag, b.tag));
  }
}
