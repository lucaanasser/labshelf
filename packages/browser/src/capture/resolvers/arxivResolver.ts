/**
 * Resolves a PDF URL from an arXiv ID using the predictable export URL pattern.
 * arXiv guarantees that "/pdf/{id}" is the canonical PDF, so this resolver
 * never has to hit an API — it just constructs the URL.
 * @depends capture/resolvers/types
 * @dependents capture/resolvers/resolverChain
 */
import type { PdfResolver, ResolveContext } from "./types";

export const arxivResolver: PdfResolver = {
  name: "arxiv",
  async resolve(ctx: ResolveContext): Promise<string[]> {
    return ctx.arxivId ? [`https://arxiv.org/pdf/${ctx.arxivId}`] : [];
  },
};
