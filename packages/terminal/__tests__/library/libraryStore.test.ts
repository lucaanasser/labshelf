import * as path from "node:path";

import { LibraryStore, paperComparator, type Entry, type SortSpec } from "../../src/library/libraryStore";
import { cleanupTempDirs, createTempLibrary, setMtime, type PaperFixture, type TempLibrary } from "../fixtures/library";

afterEach(cleanupTempDirs);

const TITLE: SortSpec = { key: "title", reverse: false };

function paperIds(entries: Entry[]): string[] {
  return entries.flatMap((e) => (e.kind === "paper" ? [e.paper.record.id] : []));
}

function collectionNames(entries: Entry[]): string[] {
  return entries.flatMap((e) => (e.kind === "collection" ? [e.node.name] : []));
}

async function openStore(papers: PaperFixture[] = [], collections: string[] = []): Promise<{ lib: TempLibrary; store: LibraryStore }> {
  const lib = await createTempLibrary(papers);
  for (const rel of collections) { await lib.addCollection(rel); }
  const store = new LibraryStore(lib.paths);
  await store.reload();
  return { lib, store };
}

describe("LibraryStore.reload", () => {
  it("starts empty (scannedAt 0) before the first reload", async () => {
    const lib = await createTempLibrary([{ id: "p1" }]);
    const store = new LibraryStore(lib.paths);
    expect(store.snapshot.papers.size).toBe(0);
    expect(store.snapshot.scannedAt).toBe(0);
    expect(store.collection("")).toMatchObject({ name: "papers", total: 0 });
    await store.reload();
    expect(store.paper("p1")?.record.id).toBe("p1");
    expect(store.snapshot.scannedAt).toBeGreaterThan(0);
  });

  it("notifies listeners with the new snapshot, and stops after unsubscribe", async () => {
    const { lib, store } = await openStore([{ id: "p1" }]);
    const seen: number[] = [];
    const off = store.onChange((snapshot) => seen.push(snapshot.papers.size));

    await lib.addPaper({ id: "p2" });
    const snapshot = await store.reload();
    expect(seen).toEqual([2]);
    expect(snapshot).toBe(store.snapshot);

    off();
    await lib.addPaper({ id: "p3" });
    await store.reload();
    expect(seen).toEqual([2]);
    expect(store.snapshot.papers.size).toBe(3);
  });

  it("coalesces concurrent reloads into one notification and one shared result", async () => {
    const { lib, store } = await openStore([{ id: "p1" }]);
    const listener = jest.fn();
    store.onChange(listener);

    await lib.addPaper({ id: "p2" });
    const results = await Promise.all(Array.from({ length: 8 }, () => store.reload()));

    expect(listener).toHaveBeenCalledTimes(1);
    expect(new Set(results).size).toBe(1);
    expect(results[0]!.papers.size).toBe(2);
  });

  it("picks up a change made while a scan is already running", async () => {
    const { lib, store } = await openStore([{ id: "p1" }]);
    const first = store.reload();
    await lib.addPaper({ id: "p2" });
    const second = store.reload();
    await Promise.all([first, second]);
    expect(store.snapshot.papers.has("p2")).toBe(true);
  });

  it("allows a new reload after the previous one finished", async () => {
    const { lib, store } = await openStore([{ id: "p1" }]);
    const listener = jest.fn();
    store.onChange(listener);
    await store.reload();
    await lib.addPaper({ id: "p2" });
    await store.reload();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(store.snapshot.papers.size).toBe(2);
  });
});

describe("LibraryStore.listCollection", () => {
  async function fixtureStore(): Promise<LibraryStore> {
    const { lib, store } = await openStore([
      { id: "pa", title: "Cherry Study", meta: { year: 2020, authors: ["Alice Zimmer"], status: "done", tags: ["nlp"] } },
      { id: "pb", title: "apple pie", meta: { year: 2018, authors: ["Smith, Bob"], status: "reading", tags: ["vision"] } },
      { id: "pc", title: "Banana Split", meta: { year: 2022, authors: ["Carol Adams"], status: "unread", tags: ["nlp"] } },
      { id: "pd", title: "No year paper", meta: { status: "unread" } },
      { id: "deep", collection: "Zeta/inner", title: "Deep paper", meta: { year: 2019 } },
    ], ["alpha", "Beta"]);
    const stamps: Record<string, string> = { pa: "2024-01-01", pb: "2024-03-01", pc: "2024-02-01", pd: "2023-01-01" };
    for (const [id, day] of Object.entries(stamps)) {
      await setMtime(path.join(lib.paperDir(id), "metadata.yaml"), new Date(`${day}T00:00:00Z`));
    }
    await store.reload();
    return store;
  }

  it("lists sub-collections first (by name), then the papers", async () => {
    const store = await fixtureStore();
    const entries = store.listCollection("", { sort: TITLE });
    const kinds = entries.map((e) => e.kind);
    expect(kinds.slice(0, 3)).toEqual(["collection", "collection", "collection"]);
    expect(kinds.slice(3)).toEqual(["paper", "paper", "paper", "paper"]);
    expect(collectionNames(entries)).toEqual(["alpha", "Beta", "Zeta"]);
  });

  it("lists only the papers directly inside a collection", async () => {
    const store = await fixtureStore();
    expect(paperIds(store.listCollection("", { sort: TITLE }))).toEqual(["pb", "pc", "pa", "pd"]);
    expect(paperIds(store.listCollection("Zeta/inner", { sort: TITLE }))).toEqual(["deep"]);
    expect(paperIds(store.listCollection("Zeta", { sort: TITLE }))).toEqual([]);
  });

  it("returns [] for an unknown collection", async () => {
    const store = await fixtureStore();
    expect(store.listCollection("Nope", { sort: TITLE })).toEqual([]);
  });

  it.each<[string, SortSpec, string[]]>([
    ["title", { key: "title", reverse: false }, ["pb", "pc", "pa", "pd"]],
    ["title reversed", { key: "title", reverse: true }, ["pd", "pa", "pc", "pb"]],
    ["year (newest first, undated last)", { key: "year", reverse: false }, ["pc", "pa", "pb", "pd"]],
    ["year reversed", { key: "year", reverse: true }, ["pd", "pb", "pa", "pc"]],
    ["author (family name, comma or last word)", { key: "author", reverse: false }, ["pd", "pc", "pb", "pa"]],
    ["author reversed", { key: "author", reverse: true }, ["pa", "pb", "pc", "pd"]],
    ["status (reading, unread, done; ties by title)", { key: "status", reverse: false }, ["pb", "pc", "pd", "pa"]],
    ["status reversed", { key: "status", reverse: true }, ["pa", "pd", "pc", "pb"]],
    ["modified (newest first)", { key: "modified", reverse: false }, ["pb", "pc", "pa", "pd"]],
    ["modified reversed", { key: "modified", reverse: true }, ["pd", "pa", "pc", "pb"]],
  ])("sorts by %s", async (_name, sort, expected) => {
    const store = await fixtureStore();
    expect(paperIds(store.listCollection("", { sort }))).toEqual(expected);
  });

  it("does not reorder the collections when the papers are reversed", async () => {
    const store = await fixtureStore();
    expect(collectionNames(store.listCollection("", { sort: { key: "title", reverse: true } }))).toEqual(["alpha", "Beta", "Zeta"]);
  });

  it("flatten lists every paper below the collection and no sub-collections", async () => {
    const store = await fixtureStore();
    const entries = store.listCollection("", { sort: TITLE, flatten: true });
    expect(collectionNames(entries)).toEqual([]);
    expect(paperIds(entries)).toEqual(["pb", "pc", "pa", "deep", "pd"]);
    expect(paperIds(store.listCollection("Zeta", { sort: TITLE, flatten: true }))).toEqual(["deep"]);
  });

  it("filters papers with the query language", async () => {
    const store = await fixtureStore();
    expect(paperIds(store.listCollection("", { sort: TITLE, filter: "tag:nlp" }))).toEqual(["pc", "pa"]);
    expect(paperIds(store.listCollection("", { sort: TITLE, filter: "is:reading" }))).toEqual(["pb"]);
    expect(paperIds(store.listCollection("", { sort: TITLE, filter: "year:2019..2021" }))).toEqual(["pa"]);
    expect(paperIds(store.listCollection("", { sort: TITLE, filter: "apple" }))).toEqual(["pb"]);
    expect(paperIds(store.listCollection("", { sort: TITLE, filter: "nothing-matches" }))).toEqual([]);
  });

  it("filters flattened listings too", async () => {
    const store = await fixtureStore();
    expect(paperIds(store.listCollection("", { sort: TITLE, flatten: true, filter: "deep" }))).toEqual(["deep"]);
  });

  it("keeps sub-collections whose name contains every filter word, hiding the others", async () => {
    const store = await fixtureStore();
    const entries = store.listCollection("", { sort: TITLE, filter: "alp" });
    expect(collectionNames(entries)).toEqual(["alpha"]);
    expect(paperIds(entries)).toEqual([]);
  });

  it("treats a blank filter as no filter", async () => {
    const store = await fixtureStore();
    const entries = store.listCollection("", { sort: TITLE, filter: "   " });
    expect(collectionNames(entries)).toHaveLength(3);
    expect(paperIds(entries)).toHaveLength(4);
  });

  // Regression: the collection name used to be only lower-cased while the terms were accent-folded.
  it("matches a collection whose name has accents, however the filter is typed", async () => {
    const { store } = await openStore([], ["Café research", "Other"]);
    expect(collectionNames(store.listCollection("", { sort: TITLE, filter: "cafe" }))).toEqual(["Café research"]);
    expect(collectionNames(store.listCollection("", { sort: TITLE, filter: "café" }))).toEqual(["Café research"]);
  });
});

describe("paperComparator", () => {
  it("falls back to the title when the primary key ties", async () => {
    const { store } = await openStore([
      { id: "b", title: "Beta", meta: { year: 2020 } },
      { id: "a", title: "Alpha", meta: { year: 2020 } },
    ]);
    const sorted = [...store.snapshot.papers.values()].sort(paperComparator({ key: "year", reverse: false }));
    expect(sorted.map((e) => e.record.id)).toEqual(["a", "b"]);
  });

  it("sorts titles with numbers numerically", async () => {
    const { store } = await openStore([
      { id: "p10", title: "Paper 10" },
      { id: "p2", title: "Paper 2" },
      { id: "p1", title: "Paper 1" },
    ]);
    expect(paperIds(store.listCollection("", { sort: TITLE }))).toEqual(["p1", "p2", "p10"]);
  });
});

describe("LibraryStore.search", () => {
  const papers: PaperFixture[] = [
    { id: "t", title: "Quantum computing basics", meta: { year: 2019, authors: ["Zed Smith"] } },
    { id: "a", title: "Cooking", meta: { year: 2021, authors: ["Quantum Chef"] } },
    { id: "r", title: "Gardening", meta: { year: 2020, note: "quantum of solace" } },
    { id: "n", title: "Nothing relevant", meta: { year: 2018 } },
  ];

  it("returns every paper, sorted, for an empty query", async () => {
    const { store } = await openStore(papers);
    expect(store.search("", TITLE).map((e) => e.record.id)).toEqual(["a", "r", "n", "t"]);
    expect(store.search("   ", { key: "year", reverse: false }).map((e) => e.record.id)).toEqual(["a", "r", "t", "n"]);
  });

  it("returns only matches, best first: title hit, then author hit, then the rest", async () => {
    const { store } = await openStore(papers);
    expect(store.search("quantum", TITLE).map((e) => e.record.id)).toEqual(["t", "a", "r"]);
  });

  it("breaks rank ties with the sort spec", async () => {
    const { store } = await openStore([
      { id: "x1", title: "Neural nets", meta: { year: 2015 } },
      { id: "x2", title: "Neural fields", meta: { year: 2022 } },
    ]);
    expect(store.search("neural", { key: "year", reverse: false }).map((e) => e.record.id)).toEqual(["x2", "x1"]);
    expect(store.search("neural", { key: "year", reverse: true }).map((e) => e.record.id)).toEqual(["x1", "x2"]);
  });

  it("applies operators across the whole library, not just one collection", async () => {
    const { store } = await openStore([
      { id: "p1", collection: "A", meta: { year: 2020, status: "done" } },
      { id: "p2", collection: "B/C", meta: { year: 2020, status: "reading" } },
    ]);
    expect(store.search("year:2020 is:r", TITLE).map((e) => e.record.id)).toEqual(["p2"]);
  });

  it("returns nothing when no paper matches", async () => {
    const { store } = await openStore(papers);
    expect(store.search("zzzz", TITLE)).toEqual([]);
  });

  it("finds a paper through its annotation text from setAnnotationText, and forgets it when replaced", async () => {
    const { store } = await openStore([{ id: "p1", title: "Plain title" }, { id: "p2", title: "Other" }]);
    expect(store.search("entanglement", TITLE)).toEqual([]);

    store.setAnnotationText(new Map([["p1", "A highlight about quantum entanglement"]]));
    expect(store.search("entanglement", TITLE).map((e) => e.record.id)).toEqual(["p1"]);

    store.setAnnotationText(new Map([["p2", "Now it is about entanglement elsewhere"]]));
    expect(store.search("entanglement", TITLE).map((e) => e.record.id)).toEqual(["p2"]);

    store.setAnnotationText(new Map());
    expect(store.search("entanglement", TITLE)).toEqual([]);
  });

  it("uses annotation text in collection filters as well", async () => {
    const { store } = await openStore([{ id: "p1" }, { id: "p2" }]);
    store.setAnnotationText(new Map([["p2", "marginal remark about eigenvalues"]]));
    expect(paperIds(store.listCollection("", { sort: TITLE, filter: "eigenvalues" }))).toEqual(["p2"]);
  });

  it("sees edits to metadata.yaml after a reload (no stale search cache)", async () => {
    const { lib, store } = await openStore([{ id: "p1", title: "Old title" }]);
    expect(store.search("fresh", TITLE)).toEqual([]);
    await lib.addPaper({ id: "p1", title: "Fresh title" });
    await store.reload();
    expect(store.search("fresh", TITLE).map((e) => e.record.id)).toEqual(["p1"]);
    expect(store.search("old", TITLE)).toEqual([]);
  });
});

describe("LibraryStore.tagCounts", () => {
  it("counts tags case-insensitively, keeps the first spelling, and sorts by count then name", async () => {
    const { store } = await openStore([
      { id: "p1", meta: { tags: ["NLP", "vision"] } },
      { id: "p2", meta: { tags: ["nlp"] } },
      { id: "p3", meta: { tags: ["Vision", "rl", "zebra"] } },
      { id: "p4", meta: { tags: ["nlp"] } },
      { id: "p5" },
    ]);
    expect(store.tagCounts()).toEqual([
      { tag: "NLP", count: 3 },
      { tag: "vision", count: 2 },
      { tag: "rl", count: 1 },
      { tag: "zebra", count: 1 },
    ]);
  });

  it("is empty for a library without tags", async () => {
    const { store } = await openStore([{ id: "p1" }]);
    expect(store.tagCounts()).toEqual([]);
  });
});
