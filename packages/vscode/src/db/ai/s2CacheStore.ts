/**
 * Persistent cache for Semantic Scholar lookups. The remote API is rate-limited
 * and lookups for a stable DOI rarely change, so we cache results indefinitely
 * with an explicit `fetched_at` for the caller to decide refresh policy.
 *
 * @depends node:sqlite
 * @dependents ai/aiIndexer S2 enrichment stage
 */
import type { DatabaseSync } from "node:sqlite";

export interface S2CacheEntry {
  cacheKey: string;
  paperId?: string;
  s2Id?: string;
  referencesJson?: string;
  citationsJson?: string;
  fetchedAt: number;
}

type Row = {
  cache_key: string;
  paper_id: string | null;
  s2_id: string | null;
  references_json: string | null;
  citations_json: string | null;
  fetched_at: number;
};

export class S2CacheStore {
  constructor(private readonly db: DatabaseSync) {}

  /**
   * Stores or refreshes a cached lookup.
   *
   * @usedBy aiIndexer S2 enrichment stage
   * @returns void
   */
  put(entry: S2CacheEntry): void {
    this.db.prepare(
      `INSERT INTO s2_cache
        (cache_key, paper_id, s2_id, references_json, citations_json, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(cache_key) DO UPDATE SET
         paper_id=excluded.paper_id,
         s2_id=excluded.s2_id,
         references_json=excluded.references_json,
         citations_json=excluded.citations_json,
         fetched_at=excluded.fetched_at`,
    ).run(
      entry.cacheKey,
      entry.paperId ?? null,
      entry.s2Id ?? null,
      entry.referencesJson ?? null,
      entry.citationsJson ?? null,
      entry.fetchedAt,
    );
  }

  /**
   * Returns the cached entry for the given key, or null when absent.
   *
   * @usedBy aiIndexer S2 enrichment stage
   * @returns Cache entry or null.
   */
  get(cacheKey: string): S2CacheEntry | null {
    const row = this.db
      .prepare(`SELECT * FROM s2_cache WHERE cache_key = ?`)
      .get(cacheKey) as Row | undefined;
    return row ? rowToEntry(row) : null;
  }
}

function rowToEntry(row: Row): S2CacheEntry {
  const entry: S2CacheEntry = { cacheKey: row.cache_key, fetchedAt: row.fetched_at };
  if (row.paper_id) entry.paperId = row.paper_id;
  if (row.s2_id) entry.s2Id = row.s2_id;
  if (row.references_json) entry.referencesJson = row.references_json;
  if (row.citations_json) entry.citationsJson = row.citations_json;
  return entry;
}
