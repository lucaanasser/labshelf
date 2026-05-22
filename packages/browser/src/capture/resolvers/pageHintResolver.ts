/**
 * First resolver in the chain: returns whatever PDF URL the page itself already
 * exposed — citation_pdf_url meta tag, link rel=alternate, or a direct .pdf anchor.
 * These hints are free (no network roundtrip) and usually correct, so they take
 * priority over external API lookups.
 * @depends capture/resolvers/types
 * @dependents capture/resolvers/resolverChain
 */
import type { PdfResolver, ResolveContext } from "./types";

export const pageHintResolver: PdfResolver = {
  name: "page-hint",
  async resolve(ctx: ResolveContext): Promise<string | undefined> {
    const h = ctx.pageHints;
    // Priority: citation_pdf_url > pageIsPdf > alternate > direct .pdf anchor.
    // citation_pdf_url is the Google Scholar standard and is the most reliable.
    if (h.citationPdfUrl) return h.citationPdfUrl;
    if (h.pageIsPdf && h.pageUrl) return h.pageUrl;
    if (h.alternatePdfUrl) return h.alternatePdfUrl;
    if (h.directPdfUrl) return h.directPdfUrl;
    return undefined;
  },
};
