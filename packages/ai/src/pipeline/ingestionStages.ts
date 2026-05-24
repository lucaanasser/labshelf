/**
 * Declarative pipeline for paper ingestion. The pipeline is an ordered list of
 * stages; each stage consumes the previous stage's output. Stages that depend
 * on external runtimes (embeddings, vision) are optional — when their provider
 * is absent, the pipeline degrades to heuristic-only.
 *
 * @depends ../types/chunk.ts, ../types/embeddingProvider.ts, ../types/vectorStore.ts, ../types/metadata.ts, ../chunking/sectionChunker.ts, ./extractMetadata.ts
 * @dependents vscode aiIndexer
 */
import type { ExtractedPdfText, PaperChunk } from "../types/chunk.js";
import type { IEmbeddingProvider } from "../types/embeddingProvider.js";
import type {
  IVectorStore,
  VectorRecord,
} from "../types/vectorStore.js";
import type { AiPaperMetadata } from "../types/metadata.js";
import { chunkBySection } from "../chunking/sectionChunker.js";
import { extractMetadata } from "./extractMetadata.js";

export interface IngestionContext {
  embedder?: IEmbeddingProvider;
  vectorStore?: IVectorStore;
  knownVocab?: Set<string>;
}

export interface IngestionResult {
  paperId: string;
  chunkCount: number;
  embeddedChunks: number;
  metadata: AiPaperMetadata;
}

/**
 * Runs the ingestion pipeline end-to-end for a single paper.
 *
 * @usedBy vscode aiIndexer
 * @returns A summary including counts and the persisted metadata snapshot.
 */
export async function runIngestion(
  extracted: ExtractedPdfText,
  context: IngestionContext,
): Promise<IngestionResult> {
  const chunks = chunkBySection(extracted);
  const embeddedChunks = await embedAndStore(chunks, context);
  const knownVocab = context.knownVocab;
  const metadata = extractMetadata(
    extracted,
    knownVocab !== undefined ? { knownVocab } : {},
  );
  return {
    paperId: extracted.paperId,
    chunkCount: chunks.length,
    embeddedChunks,
    metadata,
  };
}

async function embedAndStore(
  chunks: PaperChunk[],
  context: IngestionContext,
): Promise<number> {
  if (!context.embedder || !context.vectorStore || chunks.length === 0) return 0;
  const texts = chunks.map((c) => c.text);
  const embeddings = await context.embedder.embed(texts);
  const payload = chunks
    .map((chunk, idx) => {
      const embedding = embeddings[idx];
      if (!embedding) return null;
      const record: VectorRecord = {
        id: 0,
        paperId: chunk.paperId,
        kind: chunk.kind,
        text: chunk.text,
        ...(chunk.section !== undefined ? { section: chunk.section } : {}),
        ...(chunk.page !== undefined ? { page: chunk.page } : {}),
      };
      return { record, embedding };
    })
    .filter((p): p is { record: VectorRecord; embedding: Float32Array } => p !== null);
  await context.vectorStore.upsert(payload);
  return payload.length;
}
