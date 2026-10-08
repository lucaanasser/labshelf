import { describeIfSqlite, placeholderEnvTest, sqliteAvailable } from "./sqliteAvailable";

placeholderEnvTest("ensureAiSchema");

describeIfSqlite("ensureAiSchema", () => {
  if (!sqliteAvailable()) return;
  const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
  const { ensureAiSchema } = require("../../../src/db/ai/aiSchema");

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

  it("is idempotent", () => {
    const db = makeDb();
    ensureAiSchema(db);
    expect(() => ensureAiSchema(db)).not.toThrow();
  });
});
