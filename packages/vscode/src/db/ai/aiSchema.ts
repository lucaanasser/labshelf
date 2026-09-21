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
    text TEXT,
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
  relaxChunkTextConstraint(db);
}

// Early databases declared chunk_embeddings.text NOT NULL, while VectorRecord
// has always allowed chunks without text. SQLite cannot drop a constraint in
// place, so the table is rebuilt once; rows and ids are preserved.
function relaxChunkTextConstraint(db: DatabaseSync): void {
  const columns = db.prepare(`PRAGMA table_info(chunk_embeddings)`).all() as { name: string; notnull: number }[];
  if (!columns.some((column) => column.name === "text" && column.notnull === 1)) {
    return;
  }

  db.exec("BEGIN");
  try {
    db.exec(`
      ALTER TABLE chunk_embeddings RENAME TO chunk_embeddings_strict;
      DROP INDEX IF EXISTS idx_chunk_embeddings_paper;
      DROP INDEX IF EXISTS idx_chunk_embeddings_kind;
    `);
    db.exec(SCHEMA);
    db.exec(`
      INSERT INTO chunk_embeddings
        (id, paper_id, kind, section, page, start_offset, end_offset, text, embedding, dim, model_id, created_at)
      SELECT id, paper_id, kind, section, page, start_offset, end_offset, text, embedding, dim, model_id, created_at
        FROM chunk_embeddings_strict;
      DROP TABLE chunk_embeddings_strict;
    `);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
