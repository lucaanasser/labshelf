/**
 * Re-indexes the library after a change that happened outside this session — a
 * Drive sync that downloaded files, or a manual "Rebuild Index". It rebuilds the
 * SQLite cache from disk, then emits the paper events the list panel, the
 * sidebar tree and the AI indexer already listen for, so a paper that just
 * arrived (or one whose PDF just showed up) appears without a reload.
 *
 * Kept out of extension.ts on purpose: extension.ts is excluded from unit tests,
 * and this reconciliation is where the honest-attachment flag is refreshed.
 */
import { EVENTS } from "@labshelf/core";
import type { EventBus, PaperRecord } from "@labshelf/core";

/** The slice of the indexer reindexLibrary drives. */
export interface ReindexableIndexer {
  rebuild(): Promise<{ papers: number }>;
}

/** The slice of the database reindexLibrary reads. */
export interface ReindexableDatabase {
  listPapers(): Promise<PaperRecord[]>;
}

export interface ReindexLibraryDeps {
  database: ReindexableDatabase;
  indexer: ReindexableIndexer;
  eventBus: EventBus;
  // Queues a text-layer check for papers that now have a PDF but no verdict.
  queueCheck?: (papers: PaperRecord[]) => void;
}

/** Ids whose records appeared or changed during a reindex. */
export interface ReindexSummary {
  added: string[];
  updated: string[];
}

/**
 * Rebuilds the index and reconciles it against the previous snapshot. The
 * indexer only upserts (it never deletes), so a paper on disk can appear or
 * change, but one removed on disk stays until the next full activation.
 * @returns the ids that were added and the ids whose record changed
 */
export async function reindexLibrary(deps: ReindexLibraryDeps): Promise<ReindexSummary> {
  const before = new Map((await deps.database.listPapers()).map((paper) => [paper.id, paper]));
  await deps.indexer.rebuild();
  const after = await deps.database.listPapers();

  const added: string[] = [];
  const updated: string[] = [];
  const toCheck: PaperRecord[] = [];
  for (const paper of after) {
    const previous = before.get(paper.id);
    if (!previous) {
      added.push(paper.id);
      deps.eventBus.emit(EVENTS.PAPER_ADDED, paper);
      if (paper.hasPdf !== false && !paper.textLayer) { toCheck.push(paper); }
    } else if (stable(previous) !== stable(paper)) {
      updated.push(paper.id);
      deps.eventBus.emit(EVENTS.PAPER_UPDATED, paper);
      // A PDF that just arrived has no verdict yet, so let it be classified.
      if (paper.hasPdf !== false && !paper.textLayer && previous.hasPdf === false) { toCheck.push(paper); }
    }
  }
  if (toCheck.length > 0) { deps.queueCheck?.(toCheck); }

  return { added, updated };
}

// Order-independent structural serialization, so a record whose fields come
// back in a different order is not mistaken for a change.
function stable(value: unknown): string {
  if (value === null || typeof value !== "object") { return JSON.stringify(value) ?? "undefined"; }
  if (Array.isArray(value)) { return "[" + value.map(stable).join(",") + "]"; }
  const record = value as Record<string, unknown>;
  return "{" + Object.keys(record).sort().map((key) => JSON.stringify(key) + ":" + stable(record[key])).join(",") + "}";
}
