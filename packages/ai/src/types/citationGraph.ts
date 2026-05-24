/**
 * Types describing the citation graph and stance assignments used by F07
 * (search by claim) and F18 (field-of-influence graph).
 *
 * @depends none
 * @dependents rag/stanceDetector, external/semanticScholar, analysis/citationGapDetector
 */

export type Stance = "support" | "contradict" | "neutral";

export interface CitationNode {
  paperId: string;
  title: string;
  year?: number;
  isLocal: boolean;
}

export interface CitationEdge {
  fromPaperId: string;
  toPaperId: string;
  stance?: Stance;
  contextSnippet?: string;
}

export interface ClaimSearchResult {
  paperId: string;
  stance: Stance;
  score: number;
  bestSnippet: string;
  page?: number;
}
