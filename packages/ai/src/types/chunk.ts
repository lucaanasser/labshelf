/**
 * Domain types for textual chunks produced from a paper during ingestion.
 *
 * A chunk is the unit of embedding. Section chunking is the default; sliding
 * window chunking is reserved for paraphrase detection (F23).
 *
 * @depends none
 * @dependents chunking/*, rag/*, pipeline/ingestionStages
 */

export type ChunkKind = "section" | "sliding" | "title" | "abstract";

export interface PaperChunk {
  paperId: string;
  kind: ChunkKind;
  section?: string;
  page?: number;
  startOffset: number;
  endOffset: number;
  text: string;
  tokenCount: number;
  embedding?: Float32Array;
}

export interface PaperSection {
  heading: string;
  page: number;
  startOffset: number;
  endOffset: number;
  text: string;
}

export interface ExtractedPdfText {
  paperId: string;
  pages: { page: number; text: string }[];
  sections: PaperSection[];
}
