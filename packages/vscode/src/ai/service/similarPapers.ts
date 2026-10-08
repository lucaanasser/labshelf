/**
 * Finds the papers whose indexed content is closest to a given paper's title and abstract, one entry per paper with
 * its best chunk score. Used by the list panel's Related tab.
 *
 * @depends ai/service/aiService.ts (types only), @labshelf/core (types only)
 * @dependents extension.ts
 */
import type { PaperRecord } from "@labshelf/core";
import type { AiService } from "./aiService.js";

const CHUNKS_TO_SCAN = 40;
const MAX_PAPERS = 8;

/**
 * Ranks other papers by semantic similarity; an empty list when the AI index is not running.
 * @usedBy extension.ts (list panel findSimilar)
 * @returns up to eight papers, most similar first
 */
export async function findSimilarPapers(
  ai: Pick<AiService, "searchByText"> | null,
  paper: PaperRecord,
): Promise<Array<{ paperId: string; score: number }>> {
  const query = [paper.title, paper.summary].filter(Boolean).join("\n");
  if (!ai || !query.trim()) { return []; }
  const matches = await ai.searchByText(query, CHUNKS_TO_SCAN, { excludePaperIds: [paper.id] });
  const best = new Map<string, number>();
  for (const match of matches) {
    if (match.paperId !== paper.id) { best.set(match.paperId, Math.max(best.get(match.paperId) ?? -Infinity, match.score)); }
  }
  return [...best]
    .map(([paperId, score]) => ({ paperId, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_PAPERS);
}
