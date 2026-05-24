/**
 * Lightweight token-count estimator used to bound chunk size before sending
 * text to the embedding model. We do not run a real tokenizer here to keep
 * @labshelf/ai dependency-free; the runtime tokenizer is owned by the ONNX
 * adapter. ~4 chars per token is the well-known approximation for English
 * academic text and is adequate for chunk sizing.
 *
 * @depends none
 * @dependents chunking/sectionChunker.ts, chunking/slidingChunker.ts
 */

const CHARS_PER_TOKEN = 4;

/**
 * Approximate token count from a UTF-16 string.
 *
 * @usedBy sectionChunker, slidingChunker
 * @returns Estimated token count, rounded up.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Inverse of estimateTokens — character budget for a given token target.
 *
 * @usedBy sectionChunker, slidingChunker
 * @returns Character count corresponding to maxTokens.
 */
export function charsForTokenBudget(maxTokens: number): number {
  return Math.max(1, Math.floor(maxTokens * CHARS_PER_TOKEN));
}
