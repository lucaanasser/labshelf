/**
 * F20 — Citation gap detection. Given a list of local paper DOIs/titles and
 * the references reported by Semantic Scholar for each, returns the set of
 * external papers that are cited frequently but absent from the library.
 *
 * @depends ../types/citationGraph.ts, ../heuristics/titleDedup.ts
 * @dependents vscode citation-gap insight surface
 */
import type { CitationNode } from "../types/citationGraph.js";
import { normalizeTitle } from "../heuristics/titleDedup.js";

export interface ReferenceFromCorpus {
  fromPaperId: string;
  referencedTitle: string;
  referencedDoi?: string;
}

export interface CitationGap {
  title: string;
  doi?: string;
  citationCount: number;
  citedBy: string[];
}

/**
 * Computes citation gaps. Aggregates references across local papers and
 * removes any reference whose DOI or normalized title matches a local node.
 *
 * @usedBy vscode insights sidebar
 * @returns Gaps sorted by descending citationCount.
 */
export function detectCitationGaps(
  localNodes: CitationNode[],
  references: ReferenceFromCorpus[],
  minimumCitations = 3,
): CitationGap[] {
  const localTitles = new Set(localNodes.map((n) => normalizeTitle(n.title)));
  const localDois = new Set(
    localNodes.map((n) => n.paperId.toLowerCase()).filter((id) => id.includes("/")),
  );
  const agg = new Map<string, CitationGap>();
  for (const ref of references) {
    const normTitle = normalizeTitle(ref.referencedTitle);
    if (localTitles.has(normTitle)) continue;
    if (ref.referencedDoi && localDois.has(ref.referencedDoi.toLowerCase())) continue;
    const key = ref.referencedDoi ?? normTitle;
    const existing = agg.get(key);
    if (existing) {
      existing.citationCount += 1;
      existing.citedBy.push(ref.fromPaperId);
    } else {
      const created: CitationGap = {
        title: ref.referencedTitle,
        citationCount: 1,
        citedBy: [ref.fromPaperId],
      };
      if (ref.referencedDoi) created.doi = ref.referencedDoi;
      agg.set(key, created);
    }
  }
  return Array.from(agg.values())
    .filter((g) => g.citationCount >= minimumCitations)
    .sort((a, b) => b.citationCount - a.citationCount);
}
