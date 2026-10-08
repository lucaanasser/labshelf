/**
 * Lightweight token-count estimator used to bound chunk size before sending
 * text to the embedding model. We do not run a real tokenizer here to keep
 * the AI primitives dependency-free; embedding providers own
 * any real tokenizer. ~4 chars per token is the well-known approximation for English
 * academic text and is adequate for chunk sizing.
 */

const CHARS_PER_TOKEN = 4;

/**
 * Approximate token count from a UTF-16 string.
 *
 * @returns Estimated token count, rounded up.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Inverse of estimateTokens — character budget for a given token target.
 *
 * @returns Character count corresponding to maxTokens.
 */
export function charsForTokenBudget(maxTokens: number): number {
  return Math.max(1, Math.floor(maxTokens * CHARS_PER_TOKEN));
}
