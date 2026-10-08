/**
 * Resolves an open-access PDF URL via the Unpaywall API. Unpaywall indexes legal
 * green/gold OA copies (institutional repositories, arXiv mirrors, preprint servers)
 * for tens of millions of DOIs and returns a "best_oa_location.url_for_pdf" field.
 * Free for non-commercial use; requires a contact email as a query parameter.
 * @depends capture/resolvers/types
 * @dependents capture/resolvers/resolverChain
 */
import type { PdfResolver, ResolveContext } from "./types";

interface UnpaywallLocation {
  url_for_pdf?: string | null;
  url?: string | null;
  host_type?: string | null;
}

interface UnpaywallResponse {
  best_oa_location?: UnpaywallLocation | null;
  oa_locations?: UnpaywallLocation[];
}

export const unpaywallResolver: PdfResolver = {
  name: "unpaywall",
  async resolve(ctx: ResolveContext): Promise<string[]> {
    if (!ctx.doi) return [];
    const email = encodeURIComponent(ctx.contactEmail);
    const url = `https://api.unpaywall.org/v2/${encodeURIComponent(ctx.doi)}?email=${email}`;
    let res: Response;
    try {
      res = await fetch(url, { headers: { Accept: "application/json" } });
    } catch {
      return [];
    }
    if (!res.ok) return [];
    const payload = (await res.json()) as UnpaywallResponse;
    const out: string[] = [];
    const best = payload.best_oa_location;
    if (best?.url_for_pdf) out.push(best.url_for_pdf);
    // Then every other location, preferring publisher > repository.
    const all = [...(payload.oa_locations ?? [])].sort((a, b) => hostRank(b) - hostRank(a));
    for (const loc of all) {
      if (loc.url_for_pdf) out.push(loc.url_for_pdf);
      else if (loc.url && /\.pdf(?:[?#]|$)/i.test(loc.url)) out.push(loc.url);
    }
    return [...new Set(out)];
  },
};

function hostRank(l: UnpaywallLocation): number {
  switch ((l.host_type ?? "").toLowerCase()) {
    case "publisher":
      return 2;
    case "repository":
      return 1;
    default:
      return 0;
  }
}
