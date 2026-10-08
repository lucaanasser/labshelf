/**
 * Pipeline stage: derives AiPaperMetadata from extracted PDF text using only
 * heuristics. The runtime persists the returned object; no DB access happens
 * here.
 */
import type { ExtractedPdfText, AiPaperMetadata } from "../types/index.js";
import {
  detectDatasets,
  detectMethods,
  extractCodeRepos,
  extractCompute,
  extractLimitations,
  scoreDifficultyProfile,
  scoreReproducibility,
} from "../heuristics/index.js";

export interface ExtractMetadataOptions {
  knownVocab?: Set<string>;
}

/**
 * Computes the structured AI metadata for one paper.
 *
 * @returns Metadata snapshot tagged with indexedAt timestamp (epoch ms).
 */
export function extractMetadata(
  extracted: ExtractedPdfText,
  options: ExtractMetadataOptions = {},
): AiPaperMetadata {
  const fullText = extracted.pages.map((p) => p.text).join("\n");
  const compute = extractCompute(fullText);
  const result: AiPaperMetadata = {
    paperId: extracted.paperId,
    methods: detectMethods(fullText),
    datasets: detectDatasets(fullText),
    codeRepos: extractCodeRepos(fullText),
    reproducibility: scoreReproducibility(fullText),
    limitations: extractLimitations(fullText),
    difficultyProfile: scoreDifficultyProfile(extracted.pages, options.knownVocab),
    indexedAt: Date.now(),
  };
  if (compute !== undefined) result.compute = compute;
  return result;
}
