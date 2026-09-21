import { describeIfSqlite, placeholderEnvTest, sqliteAvailable } from "./sqliteAvailable";

placeholderEnvTest("ensureAiSchema");

describeIfSqlite("ensureAiSchema", () => {
  if (!sqliteAvailable()) return;
  const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
  const { ensureAiSchema } = require("../../../src/db/ai/aiSchema");

  // The chunk_embeddings layout shipped before text became optional.
  const LEGACY_CHUNKS = `
    CREATE TABLE chunk_embeddings (
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
    CREATE INDEX idx_chunk_embeddings_paper ON chunk_embeddings(paper_id);
    CREATE INDEX idx_chunk_embeddings_kind ON chunk_embeddings(kind);
  `;

  const INSERT_CHUNK = `INSERT INTO chunk_embeddings (paper_id, kind, text, embedding, dim, model_id, created_at)
    VALUES ('p1', 'section', ?, x'00', 1, 'm', 0)`;

  function makeDb() {
    const db = new DatabaseSync(":memory:");
    db.exec(`CREATE TABLE papers (id TEXT PRIMARY KEY);`);
    db.prepare(`INSERT INTO papers (id) VALUES ('p1')`).run();
    return db;
  }

  it("accepts chunks without text on a fresh database", () => {
    const db = makeDb();
    ensureAiSchema(db);
    expect(() => db.prepare(INSERT_CHUNK).run(null)).not.toThrow();
  });

  it("relaxes the legacy NOT NULL text column and keeps existing rows", () => {
    const db = makeDb();
    db.exec(LEGACY_CHUNKS);
    db.prepare(INSERT_CHUNK).run("kept");

    ensureAiSchema(db);

    expect(() => db.prepare(INSERT_CHUNK).run(null)).not.toThrow();
    const rows = db.prepare(`SELECT id, text FROM chunk_embeddings ORDER BY id`).all();
    expect(rows).toEqual([{ id: 1, text: "kept" }, { id: 2, text: null }]);
    const indexes = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'chunk_embeddings'`).all();
    expect(indexes.map((i) => String(i["name"])).sort()).toEqual(["idx_chunk_embeddings_kind", "idx_chunk_embeddings_paper"]);
  });

  it("is idempotent", () => {
    const db = makeDb();
    db.exec(LEGACY_CHUNKS);
    ensureAiSchema(db);
    expect(() => ensureAiSchema(db)).not.toThrow();
  });
});
