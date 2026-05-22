/**
 * Shared types for the PDF resolver chain. Each resolver attempts to turn the
 * accumulated identifiers + page hints into a downloadable PDF URL.
 * @depends capture/pageProbeContentScript
 * @dependents capture/resolvers/*, capture/captureService
 */
import type { PageProbeResult } from "../pageProbeContentScript";

/** Context shared with every resolver in the chain. */
export interface ResolveContext {
  doi?: string;
  arxivId?: string;
  pmid?: string;
  pageHints: PageProbeResult;
  /** When true, Sci-Hub resolver is permitted to run. */
  allowSciHub: boolean;
  /** Contact email used by Unpaywall and the CrossRef User-Agent. */
  contactEmail: string;
  /** Sci-Hub mirror base URL, e.g. "https://sci-hub.se" (no trailing slash). */
  sciHubMirror: string;
}

/** The result a resolver returns when it succeeds. */
export interface ResolvedPdf {
  url: string;
  /** Identifies which resolver produced this — used for logging and UI. */
  source: string;
}

/** A single step in the PDF resolution chain. */
export interface PdfResolver {
  /** Stable short name for logs ("page-hint", "arxiv", "crossref", etc). */
  readonly name: string;
  /**
   * Returns a PDF URL when this resolver succeeds, or undefined when it
   * cannot help. Throwing is allowed but only for hard errors (e.g. invalid
   * input); soft misses should return undefined so the chain continues.
   */
  resolve(ctx: ResolveContext): Promise<string | undefined>;
}
