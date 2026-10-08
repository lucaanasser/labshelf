/**
 * Shared types for the PDF resolver chain. Each resolver turns the identifiers
 * and page evidence gathered so far into URLs that may serve the paper's PDF;
 * the chain downloads them in order and keeps the first that really is one.
 * @depends capture/pageFacts (types)
 * @dependents capture/resolvers/*, capture/captureService
 */
import type { PdfCandidate } from "../pageFacts";

/** Context shared with every resolver in the chain. */
export interface ResolveContext {
  doi?: string;
  arxivId?: string;
  pmid?: string;
  /**
   * PubMed Central id in canonical "PMC1234567" form, when known. Learned by
   * pubmed/openalex/europePmc resolvers and consumed by the pmc resolver, which
   * turns it into open-access PDF candidates.
   */
  pmcid?: string;
  /** The paper's title — drives title-only searches and wrong-item verification (sameWork). */
  title?: string;
  /** Author display names ("Given Family"), used for the shared-surname check in sameWork. */
  authors?: string[];
  /** Publication year, used for the year tolerance in sameWork. */
  year?: number;
  /** The article's landing page, when known — some platforms key the PDF by it, not the DOI. */
  landingUrl?: string;
  /** PDF links the page (or Scholar result) itself offered, best first. */
  pageCandidates: PdfCandidate[];
  /** When true, the Sci-Hub resolver is permitted to run (user opt-in, off by default). */
  allowSciHub: boolean;
  /** Contact email used by Unpaywall and the CrossRef User-Agent. */
  contactEmail: string;
  /** Sci-Hub mirror base URL, e.g. "https://sci-hub.se" (no trailing slash). */
  sciHubMirror: string;
}

/** The PDF the chain settled on. */
export interface ResolvedPdf {
  bytes: Uint8Array;
  url: string;
  /** Which resolver suggested it — shown to the user and logged. */
  source: string;
}

/** A single step in the PDF resolution chain. */
export interface PdfResolver {
  /** Stable short name for logs and UI ("page", "publisher", "arxiv", ...). */
  readonly name: string;
  /**
   * Returns candidate URLs, best first, or an empty list when this resolver
   * cannot help. Soft misses must not throw so the chain continues.
   */
  resolve(ctx: ResolveContext): Promise<string[]>;
}
