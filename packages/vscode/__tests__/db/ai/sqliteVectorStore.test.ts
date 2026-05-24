import { describeIfSqlite, placeholderEnvTest, sqliteAvailable } from "./sqliteAvailable";

placeholderEnvTest("SqliteVectorStore");

describeIfSqlite("SqliteVectorStore", () => {
  if (!sqliteAvailable()) return;
  const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
  const { SqliteVectorStore } = require("../../../src/db/ai/sqliteVectorStore");
  const { ensureAiSchema } = require("../../../src/db/ai/aiSchema");

  function makeDb() {
    const db = new DatabaseSync(":memory:");
    db.exec(`CREATE TABLE papers (id TEXT PRIMARY KEY, title TEXT, path TEXT, citekey TEXT, status TEXT);`);
    db.prepare(`INSERT INTO papers (id, title, path, citekey, status) VALUES (?, 'p', '/p', 'k', 'unread')`).run("p1");
    db.prepare(`INSERT INTO papers (id, title, path, citekey, status) VALUES (?, 'p', '/p', 'k', 'unread')`).run("p2");
    ensureAiSchema(db);
    return db;
  }

  it("upserts and retrieves by cosine top-k", async () => {
    const store = new SqliteVectorStore(makeDb(), "test-model");
    await store.upsert([
      { record: { id: 0, paperId: "p1", kind: "section", text: "alpha" }, embedding: new Float32Array([1, 0, 0]) },
      { record: { id: 0, paperId: "p2", kind: "section", text: "beta" }, embedding: new Float32Array([0, 1, 0]) },
    ]);
    const results = await store.search(new Float32Array([1, 0, 0]), 2);
    expect(results[0].paperId).toBe("p1");
    expect(results[0].score).toBeCloseTo(1, 5);
  });

  it("respects paperId filter", async () => {
    const store = new SqliteVectorStore(makeDb(), "test-model");
    await store.upsert([
      { record: { id: 0, paperId: "p1", kind: "section" }, embedding: new Float32Array([1, 0, 0]) },
      { record: { id: 0, paperId: "p2", kind: "section" }, embedding: new Float32Array([1, 0, 0]) },
    ]);
    const results = await store.search(new Float32Array([1, 0, 0]), 5, { paperIds: ["p2"] });
    expect(results.every((r: { paperId: string }) => r.paperId === "p2")).toBe(true);
  });

  it("deleteByPaper removes vectors", async () => {
    const store = new SqliteVectorStore(makeDb(), "test-model");
    await store.upsert([
      { record: { id: 0, paperId: "p1", kind: "section" }, embedding: new Float32Array([1, 0, 0]) },
    ]);
    await store.deleteByPaper("p1");
    const results = await store.search(new Float32Array([1, 0, 0]), 5);
    expect(results).toEqual([]);
  });
});
