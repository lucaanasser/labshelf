/**
 * Runs every resolver in priority order and downloads their candidate URLs
 * until one really is a PDF (capture/pdfFetcher checks the bytes). Resolvers
 * that mutate context (pubmed → DOI) run first so later resolvers can use the
 * populated identifier.
 * @depends capture/resolvers/*, capture/pdfFetcher
 * @dependents capture/captureService
 */
import type { PdfResolver, ResolveContext, ResolvedPdf } from "./types";
import { pageHintResolver } from "./pageHintResolver";
import { publisherResolver } from "./publisherResolver";
import { arxivResolver } from "./arxivResolver";
import { crossrefResolver } from "./crossrefResolver";
import { unpaywallResolver } from "./unpaywallResolver";
import { pubmedResolver } from "./pubmedResolver";
import { sciHubResolver } from "./scihubResolver";
import { fetchPdf } from "../pdfFetcher";
import type { PdfFetchOptions } from "../pdfFetcher";

// Order matters: what the page offered beats a constructed publisher URL,
// which beats an API lookup. pubmed runs first so its DOI benefits the rest.
const CHAIN: PdfResolver[] = [
  pubmedResolver,
  pageHintResolver,
  arxivResolver,
  publisherResolver,
  crossrefResolver,
  unpaywallResolver,
  sciHubResolver,
];

/** One attempt, for the capture log. */
export interface PdfAttempt {
  source: string;
  url: string;
}

// A background tab costs seconds: one tab, for the site of the best blocked
// candidate, which then tries that site's blocked candidates in order.
const HELPER_TAB_URLS = 3;

/**
 * Walks the chain and returns the first candidate that downloads as a PDF.
 * Candidates refused by a bot check are retried at the end through a real
 * tab, when the runtime offers one. `attempts` collects every URL tried, so a
 * failure can be explained.
 * @usedBy capture/captureService
 */
export async function resolvePdf(
  ctx: ResolveContext,
  fetchOpts: PdfFetchOptions = {},
  attempts: PdfAttempt[] = [],
): Promise<ResolvedPdf | undefined> {
  const blocked: string[] = [];
  const opts: PdfFetchOptions = { ...fetchOpts, blocked };
  const tried = new Set<string>();
  for (const resolver of CHAIN) {
    let urls: string[];
    try {
      urls = await resolver.resolve(ctx);
    } catch {
      urls = [];
    }
    for (const url of urls) {
      if (tried.has(url)) continue;
      tried.add(url);
      // Page links keep the label of whoever offered them ("page", "scholar").
      const source = resolver === pageHintResolver
        ? ctx.pageCandidates.find((c) => c.url === url)?.source ?? resolver.name
        : resolver.name;
      attempts.push({ source, url });
      const pdf = await fetchPdf(url, opts);
      if (pdf) return { bytes: pdf.bytes, url: pdf.url, source };
    }
  }

  if (fetchOpts.viaHelperTab && blocked.length) {
    const site = new URL(blocked[0]!).origin;
    const urls = blocked.filter((u) => new URL(u).origin === site).slice(0, HELPER_TAB_URLS);
    attempts.push(...urls.map((url) => ({ source: `${sourceOf(attempts, url)} (via tab)`, url })));
    const pdf = await fetchOpts.viaHelperTab(urls).catch(() => undefined);
    if (pdf) return { bytes: pdf.bytes, url: pdf.url, source: sourceOf(attempts, pdf.url, urls) };
  }
  return undefined;
}

// The resolver that first proposed `url` (or, for a redirected download, the
// first of the URLs handed to the helper tab).
function sourceOf(attempts: PdfAttempt[], url: string, fallbackFrom: string[] = []): string {
  const direct = attempts.find((a) => a.url === url && !a.source.endsWith("(via tab)"));
  if (direct) return direct.source;
  const first = fallbackFrom.map((u) => attempts.find((a) => a.url === u && !a.source.endsWith("(via tab)"))).find(Boolean);
  return first?.source ?? "page";
}
