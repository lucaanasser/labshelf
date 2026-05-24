/**
 * Wires the AI subsystem together from the dependencies that extension.ts
 * already constructs (database, event bus, logger, paths) plus the optional
 * ONNX runtime. Returns null when AI is disabled in settings; returns a
 * degraded service when the ONNX runtime fails to load.
 *
 * @depends vscode, @labshelf/core, db/ai/*, runtime/*, pdf/*, indexer/*, ./aiService.ts
 * @dependents extension.ts activate()
 */
import * as vscode from "vscode";
import type { ExtensionEventBus, ILogger, PdfDocumentOpener } from "@labshelf/core";
import { EVENTS } from "@labshelf/core";
import type { IEmbeddingProvider } from "@labshelf/ai";
import { AiMetadataStore, ReadingEventsStore, SqliteVectorStore } from "../../db/ai/index.js";
import { FileSystemService } from "../../storage/fileSystemService.js";
import { SqliteResearchDatabase } from "../../db/sqliteResearchDatabase.js";
import { PdfTextExtractor } from "../pdf/pdfTextExtractor.js";
import {
  HashEmbeddingProvider,
  OnnxEmbeddingProvider,
  TEXT_EMBEDDING_DEFAULT_ID,
  findModel,
  ModelDownloader,
} from "../runtime/index.js";
import { AiIndexer } from "../indexer/aiIndexer.js";
import { IndexerQueue } from "../indexer/indexerQueue.js";
import { AiService } from "./aiService.js";

export interface AiServiceFactoryDependencies {
  context: vscode.ExtensionContext;
  database: SqliteResearchDatabase;
  fileSystem: FileSystemService;
  eventBus: ExtensionEventBus;
  logger: ILogger;
  pdfOpener: PdfDocumentOpener;
  resolvePdfUri: (paperId: string) => vscode.Uri | null;
  preferOnnx?: boolean;
}

/**
 * Builds the AiService graph. Caller must dispose the indexer when activation
 * is torn down (returned in `dispose`).
 *
 * @usedBy extension.ts activate()
 * @returns AiService instance plus a disposer.
 */
export async function createAiService(
  deps: AiServiceFactoryDependencies,
): Promise<{ service: AiService; dispose: () => void } | null> {
  const config = vscode.workspace.getConfiguration("labshelf.ai");
  if (config.get<boolean>("enabled") === false) return null;

  const rawConnection = deps.database.rawConnection();
  const { embedder, degradedMode } = await resolveEmbedder(deps);
  const vectorStore = new SqliteVectorStore(rawConnection, embedder.modelId);
  const metadataStore = new AiMetadataStore(rawConnection);
  const readingEvents = new ReadingEventsStore(rawConnection);
  const extractor = new PdfTextExtractor(deps.pdfOpener, deps.fileSystem);
  const queue = new IndexerQueue(deps.logger);
  const indexer = new AiIndexer({
    database: deps.database,
    eventBus: deps.eventBus,
    logger: deps.logger,
    embedder,
    vectorStore,
    metadataStore,
    extractor,
    resolvePdfUri: deps.resolvePdfUri,
    fileSystem: { readBinary: (uri) => deps.fileSystem.readBinary(uri) },
    enqueue: (job) => queue.enqueue(job),
  });
  const detach = indexer.attach();
  const service = new AiService({
    embedder,
    vectorStore,
    metadataStore,
    readingEvents,
    indexer,
    queue,
    eventBus: deps.eventBus,
    logger: deps.logger,
    degradedMode,
  });
  return { service, dispose: detach };
}

async function resolveEmbedder(
  deps: AiServiceFactoryDependencies,
): Promise<{ embedder: IEmbeddingProvider; degradedMode: boolean }> {
  if (deps.preferOnnx === false) {
    return { embedder: new HashEmbeddingProvider(), degradedMode: true };
  }
  try {
    const descriptor = findModel(TEXT_EMBEDDING_DEFAULT_ID);
    if (!descriptor) throw new Error("Missing default text-embedding descriptor");
    const downloader = new ModelDownloader({
      globalStorage: deps.context.globalStorageUri,
      eventBus: deps.eventBus,
    });
    await downloader.ensureModel(descriptor);
    return {
      embedder: new OnnxEmbeddingProvider(deps.context.globalStorageUri, descriptor.id),
      degradedMode: false,
    };
  } catch (error) {
    deps.eventBus.emit(EVENTS.AI_MODEL_FAILED, {
      modelId: TEXT_EMBEDDING_DEFAULT_ID,
      reason: error instanceof Error ? error.message : String(error),
    });
    void deps.logger.error("ai/factory", error, { stage: "embedder" });
    return { embedder: new HashEmbeddingProvider(), degradedMode: true };
  }
}
