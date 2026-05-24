/**
 * Sliding-window chunker used for paraphrase detection (F23). Operates on
 * sentence boundaries so chunks remain comparable to indexed library content.
 *
 * @depends ../types/chunk.ts, ./tokenEstimator.ts
 * @dependents vscode ParaphraseGuardProvider (phase 1)
 */
import type { PaperChunk } from "../types/chunk.js";
import { estimateTokens } from "./tokenEstimator.js";

export interface SlidingChunkerOptions {
  windowTokens: number;
  strideTokens: number;
}

const DEFAULT_OPTIONS: SlidingChunkerOptions = {
  windowTokens: 32,
  strideTokens: 16,
};

const SENTENCE_BOUNDARY = /(?<=[.!?])\s+/;

/**
 * Produces overlapping sliding windows over arbitrary text.
 *
 * @usedBy ParaphraseGuardProvider
 * @returns Ordered list of sliding chunks tagged with offsets in the source.
 */
export function chunkBySlidingWindow(
  source: string,
  paperId: string,
  options: SlidingChunkerOptions = DEFAULT_OPTIONS,
): PaperChunk[] {
  const sentences = splitSentences(source);
  if (sentences.length === 0) return [];
  const chunks: PaperChunk[] = [];
  const window: { sentence: string; offset: number }[] = [];
  let tokens = 0;
  for (const item of sentences) {
    window.push(item);
    tokens += estimateTokens(item.sentence);
    while (tokens > options.windowTokens && window.length > 1) {
      chunks.push(materialize(window, paperId));
      const dropped = window.shift();
      if (dropped) tokens -= estimateTokens(dropped.sentence);
      if (tokens <= options.strideTokens) break;
    }
  }
  if (window.length > 0) chunks.push(materialize(window, paperId));
  return dedupeChunks(chunks);
}

function splitSentences(text: string): { sentence: string; offset: number }[] {
  const out: { sentence: string; offset: number }[] = [];
  let cursor = 0;
  for (const sentence of text.split(SENTENCE_BOUNDARY)) {
    const trimmed = sentence.trim();
    if (trimmed.length === 0) {
      cursor += sentence.length + 1;
      continue;
    }
    out.push({ sentence: trimmed, offset: cursor });
    cursor += sentence.length + 1;
  }
  return out;
}

function materialize(
  window: { sentence: string; offset: number }[],
  paperId: string,
): PaperChunk {
  const first = window[0];
  const last = window[window.length - 1];
  const text = window.map((w) => w.sentence).join(" ");
  const start = first ? first.offset : 0;
  const end = last ? last.offset + last.sentence.length : text.length;
  return {
    paperId,
    kind: "sliding",
    startOffset: start,
    endOffset: end,
    text,
    tokenCount: estimateTokens(text),
  };
}

function dedupeChunks(chunks: PaperChunk[]): PaperChunk[] {
  const seen = new Set<string>();
  return chunks.filter((c) => {
    const key = `${c.startOffset}:${c.endOffset}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
