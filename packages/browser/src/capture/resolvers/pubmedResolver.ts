/**
 * Resolves a DOI from a PMID via the NCBI E-utilities ESummary endpoint, then
 * populates ctx.doi so downstream resolvers (CrossRef, Unpaywall, Sci-Hub) can run.
 * This resolver is unique — it never returns a PDF URL itself; it mutates ctx so
 * later resolvers gain a DOI to work with.
 * @depends capture/resolvers/types
 * @dependents capture/resolvers/resolverChain
 */
import type { PdfResolver, ResolveContext } from "./types";

interface EsummaryResult {
  result?: Record<string, { articleids?: Array<{ idtype?: string; value?: string }> }>;
}

export const pubmedResolver: PdfResolver = {
  name: "pubmed",
  async resolve(ctx: ResolveContext): Promise<string | undefined> {
    if (!ctx.pmid || ctx.doi) return undefined;
    const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${ctx.pmid}&retmode=json`;
    let res: Response;
    try {
      res = await fetch(url, { headers: { Accept: "application/json" } });
    } catch {
      return undefined;
    }
    if (!res.ok) return undefined;
    const payload = (await res.json()) as EsummaryResult;
    const record = payload.result?.[ctx.pmid];
    const doi = record?.articleids?.find((a) => a.idtype === "doi")?.value;
    if (doi) {
      // Mutate the context so subsequent resolvers in the chain see the DOI.
      ctx.doi = doi;
    }
    // Always return undefined: PubMed itself does not host the PDF.
    return undefined;
  },
};
