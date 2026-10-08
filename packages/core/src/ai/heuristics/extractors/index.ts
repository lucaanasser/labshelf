/**
 * Extractors that pull structured facts (methods, datasets, repos, compute, limitations, citations) from paper text.
 */
export { detectMethods } from "./methodDetector.js";
export { detectDatasets } from "./datasetExtractor.js";
export { extractCodeRepos } from "./codeRepoExtractor.js";
export { extractCompute } from "./computeExtractor.js";
export { extractLimitations } from "./limitationsExtractor.js";
export { extractCitations } from "./citationExtractor.js";
export type { CitationMark } from "./citationExtractor.js";
