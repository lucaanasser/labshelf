import * as vscode from "vscode";
import { AiIndexer } from "../../../src/ai/indexer/aiIndexer";
import type { AiIndexerDependencies } from "../../../src/ai/indexer/aiIndexer";

jest.mock("@labshelf/core", () => ({
  ...jest.requireActual("@labshelf/core"),
  runIngestion: jest.fn(async () => ({ metadata: {}, chunkCount: 1, embeddedChunks: 1 })),
}));

// Runs queued jobs immediately and lets the test await them.
function makeIndexer(resolvePdfUri: AiIndexerDependencies["resolvePdfUri"]) {
  const jobs: Promise<void>[] = [];
  const deps = {
    database: { listPapers: jest.fn(async () => [{ id: "p1" }]) },
    eventBus: { emit: jest.fn(), on: jest.fn(), off: jest.fn() },
    logger: { error: jest.fn(async () => {}), log: jest.fn(async () => {}) },
    embedder: {},
    vectorStore: {},
    metadataStore: { listIndexed: jest.fn(() => new Map()), upsert: jest.fn() },
    extractor: { extract: jest.fn(async () => ({})) },
    resolvePdfUri,
    fileSystem: { readFile: jest.fn(async () => new Uint8Array([1, 2, 3])) },
    enqueue: (job: () => Promise<void>) => { jobs.push(job()); },
  };
  const indexer = new AiIndexer(deps as unknown as AiIndexerDependencies);
  return { indexer, deps, drain: () => Promise.all(jobs) };
}

describe("AiIndexer PDF resolution", () => {
  it("reads the PDF from wherever the resolver says the paper lives", async () => {
    const nested = vscode.Uri.file("/lib/papers/Project/Refs/p1/paper.pdf");
    const { indexer, deps, drain } = makeIndexer(async () => nested);

    await indexer.rebuildAll();
    await drain();

    expect(deps.fileSystem.readFile).toHaveBeenCalledWith(nested.fsPath);
    expect(deps.extractor.extract).toHaveBeenCalledWith("p1", nested);
    expect(deps.metadataStore.upsert).toHaveBeenCalled();
  });

  it("skips a paper the resolver cannot locate without emitting index events", async () => {
    const { indexer, deps, drain } = makeIndexer(async () => null);

    await indexer.rebuildAll();
    await drain();

    expect(deps.fileSystem.readFile).not.toHaveBeenCalled();
    expect(deps.eventBus.emit).not.toHaveBeenCalled();
  });
});
