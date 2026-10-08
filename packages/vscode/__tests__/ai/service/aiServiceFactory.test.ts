import * as vscode from "vscode";
import { createAiService } from "../../../src/ai/service/aiServiceFactory";
import type { AiServiceFactoryDependencies } from "../../../src/ai/service/aiServiceFactory";
import { HashEmbeddingProvider } from "../../../src/ai/runtime";
import { SqliteVectorStore } from "../../../src/db/ai/index";

jest.mock("../../../src/db/ai/index", () => ({
  AiMetadataStore: jest.fn(),
  ReadingEventsStore: jest.fn(),
  SqliteVectorStore: jest.fn(),
}));
jest.mock("../../../src/ai/pdf/pdfTextExtractor", () => ({ PdfTextExtractor: jest.fn() }));
jest.mock("../../../src/ai/indexer/aiIndexer", () => ({
  AiIndexer: jest.fn(() => ({ attach: () => () => {} })),
}));
jest.mock("../../../src/ai/indexer/indexerQueue", () => ({
  IndexerQueue: jest.fn(() => ({ size: () => 0, isRunning: () => false })),
}));

function makeDeps() {
  return {
    context: {},
    database: { rawConnection: () => ({}) },
    fileSystem: {},
    eventBus: { emit: jest.fn(), on: jest.fn(), off: jest.fn() },
    logger: { error: jest.fn(async () => {}), log: jest.fn(async () => {}) },
    pdfOpener: {},
    resolvePdfUri: async () => null,
  } as unknown as AiServiceFactoryDependencies;
}

describe("createAiService", () => {
  it("embeds with the hash provider and keys vector rows by its model id", async () => {
    const deps = makeDeps();

    const result = await createAiService(deps);

    const hashModelId = new HashEmbeddingProvider().modelId;
    expect(SqliteVectorStore).toHaveBeenCalledWith({}, hashModelId);
    expect(result?.service.status()).toMatchObject({
      embeddingModelId: hashModelId,
      embeddingDimensions: 384,
    });
    expect(deps.eventBus.emit).not.toHaveBeenCalled();
    expect(deps.logger.error).not.toHaveBeenCalled();
  });

  it("returns null when AI is disabled in settings", async () => {
    const get = jest.fn(() => false);
    jest.spyOn(vscode.workspace, "getConfiguration").mockReturnValue({ get } as never);

    expect(await createAiService(makeDeps())).toBeNull();
  });
});
