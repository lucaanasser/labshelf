/**
 * First resolver in the chain: the PDF links the page itself offered — the
 * tab when it is a PDF, an embedded viewer, citation_pdf_url, rel=alternate,
 * then anchors that name the paper. Free (no API call) and usually right.
 * @depends capture/resolvers/types
 * @dependents capture/resolvers/resolverChain
 */
import type { PdfResolver, ResolveContext } from "./types";

export const pageHintResolver: PdfResolver = {
  name: "page",
  async resolve(ctx: ResolveContext): Promise<string[]> {
    return ctx.pageCandidates.map((c) => c.url);
  },
};
