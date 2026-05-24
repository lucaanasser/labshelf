/**
 * Ensures the AI subsystem tables exist on the shared SQLite database used by
 * @labshelf/vscode. Schema is additive — calling it multiple times is safe —
 * and embeddings are stored as raw BLOB float32 vectors. A future migration
 * may attach sqlite-vec for accelerated top-k, but the table layout is
 * deliberately compatible with both flat-scan and vec0-backed access.
 *
 * @depends node:sqlite
 * @dependents db/sqliteResearchDatabase.ts initialize()
 */
import type { DatabaseSync } from "node:sqlite";

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS chunk_embeddings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    section TEXT,
    page INTEGER,
    start_offset INTEGER,
    end_offset INTEGER,
    text TEXT NOT NULL,
    embedding BLOB NOT NULL,
    dim INTEGER NOT NULL,
    model_id TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_chunk_embeddings_paper ON chunk_embeddings(paper_id);
  CREATE INDEX IF NOT EXISTS idx_chunk_embeddings_kind ON chunk_embeddings(kind);

  CREATE TABLE IF NOT EXISTS figure_embeddings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
    page INTEGER NOT NULL,
    bbox TEXT,
    caption TEXT,
    embedding BLOB NOT NULL,
    dim INTEGER NOT NULL,
    model_id TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_figure_embeddings_paper ON figure_embeddings(paper_id);

  CREATE TABLE IF NOT EXISTS paper_metadata_ai (
    paper_id TEXT PRIMARY KEY REFERENCES papers(id) ON DELETE CASCADE,
    methods TEXT NOT NULL,
    datasets TEXT NOT NULL,
    code_repos TEXT NOT NULL,
    reproducibility TEXT NOT NULL,
    compute TEXT,
    limitations TEXT NOT NULL,
    difficulty_profile TEXT NOT NULL,
    indexed_at INTEGER NOT NULL,
    content_hash TEXT
  );

  CREATE TABLE IF NOT EXISTS reading_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    paper_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    page INTEGER,
    duration_ms INTEGER,
    topic_cluster TEXT,
    occurred_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_reading_events_paper ON reading_events(paper_id);
  CREATE INDEX IF NOT EXISTS idx_reading_events_time ON reading_events(occurred_at);

  CREATE TABLE IF NOT EXISTS s2_cache (
    cache_key TEXT PRIMARY KEY,
    paper_id TEXT,
    s2_id TEXT,
    references_json TEXT,
    citations_json TEXT,
    fetched_at INTEGER NOT NULL
  );
`;

/**
 * Applies the AI subsystem schema. Safe to call multiple times.
 *
 * @usedBy SqliteResearchDatabase.initialize
 * @returns void
 */
export function ensureAiSchema(db: DatabaseSync): void {
  db.exec(SCHEMA);
}
