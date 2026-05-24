import { describeIfSqlite, placeholderEnvTest, sqliteAvailable } from "./sqliteAvailable";

placeholderEnvTest("ReadingEventsStore");

describeIfSqlite("ReadingEventsStore", () => {
  if (!sqliteAvailable()) return;
  const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
  const { ReadingEventsStore } = require("../../../src/db/ai/readingEventsStore");
  const { ensureAiSchema } = require("../../../src/db/ai/aiSchema");

  function makeStore() {
    const db = new DatabaseSync(":memory:");
    db.exec(`CREATE TABLE papers (id TEXT PRIMARY KEY);`);
    ensureAiSchema(db);
    return new ReadingEventsStore(db);
  }

  it("appends and lists events in order", () => {
    const store = makeStore();
    store.append({ paperId: "p1", kind: "open", occurredAt: 100 });
    store.append({
      paperId: "p1",
      kind: "scroll",
      occurredAt: 200,
      page: 4,
      durationMs: 5_000,
      topicCluster: "RAG",
    });
    const events = store.listSince(0);
    expect(events).toHaveLength(2);
    expect(events[0].kind).toBe("open");
    expect(events[1].topicCluster).toBe("RAG");
  });

  it("listSince filters by timestamp", () => {
    const store = makeStore();
    store.append({ paperId: "p1", kind: "open", occurredAt: 100 });
    store.append({ paperId: "p1", kind: "close", occurredAt: 300 });
    expect(store.listSince(200)).toHaveLength(1);
  });

  it("pruneOlderThan removes old rows", () => {
    const store = makeStore();
    store.append({ paperId: "p1", kind: "open", occurredAt: 50 });
    store.append({ paperId: "p1", kind: "close", occurredAt: 500 });
    expect(store.pruneOlderThan(200)).toBe(1);
    expect(store.listSince(0)).toHaveLength(1);
  });
});
