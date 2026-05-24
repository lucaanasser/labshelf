import type { AiPaperMetadata } from "@labshelf/ai";
import { describeIfSqlite, placeholderEnvTest, sqliteAvailable } from "./sqliteAvailable";

placeholderEnvTest("AiMetadataStore");

describeIfSqlite("AiMetadataStore", () => {
  if (!sqliteAvailable()) return;
  const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
  const { AiMetadataStore } = require("../../../src/db/ai/aiMetadataStore");
  const { ensureAiSchema } = require("../../../src/db/ai/aiSchema");

  function makeDb() {
    const db = new DatabaseSync(":memory:");
    db.exec(`CREATE TABLE papers (id TEXT PRIMARY KEY);`);
    db.prepare(`INSERT INTO papers (id) VALUES (?)`).run("p1");
    ensureAiSchema(db);
    return db;
  }

  function makeMetadata(): AiPaperMetadata {
    return {
      paperId: "p1",
      methods: ["contrastive"],
      datasets: ["ImageNet"],
      codeRepos: [{ url: "https://github.com/x/y", provider: "github", status: "unknown" }],
      reproducibility: {
        score: 6,
        hasCode: true,
        hasData: true,
        hasHyperparams: true,
        hasSeeds: false,
        hasHardwareDetails: false,
      },
      limitations: ["English only"],
      difficultyProfile: { 1: 0.3, 2: 0.5 },
      indexedAt: 1700000000000,
    };
  }

  it("round-trips a full metadata record", () => {
    const store = new AiMetadataStore(makeDb());
    const meta = makeMetadata();
    store.upsert(meta);
    expect(store.get("p1")).toEqual(meta);
  });

  it("returns null for unknown papers", () => {
    expect(new AiMetadataStore(makeDb()).get("nope")).toBeNull();
  });

  it("upsert replaces previous record", () => {
    const store = new AiMetadataStore(makeDb());
    store.upsert(makeMetadata());
    const updated = { ...makeMetadata(), methods: ["distillation"] };
    store.upsert(updated, "abc");
    expect(store.get("p1")?.methods).toEqual(["distillation"]);
    expect(store.listIndexed().get("p1")).toBe("abc");
  });
});
