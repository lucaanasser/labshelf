/**
 * Resolves a PDF URL via CrossRef metadata. CrossRef stores publisher-provided
 * "link" entries for many DOIs; some are content-type application/pdf, which is
 * exactly what we want. This succeeds for paywalled publishers when the article
 * happens to be Open Access or hybrid-OA at the publisher's discretion.
 * @depends capture/resolvers/types
 * @dependents capture/resolvers/resolverChain
 */
import type { PdfResolver, ResolveContext } from "./types";

interface CrossRefLink {
  URL?: string;
  "content-type"?: string;
  "intended-application"?: string;
}

interface CrossRefMessage {
  message?: {
    link?: CrossRefLink[];
  };
}

export const crossrefResolver: PdfResolver = {
  name: "crossref",
  async resolve(ctx: ResolveContext): Promise<string | undefined> {
    if (!ctx.doi) return undefined;
    const url = `https://api.crossref.org/works/${encodeURIComponent(ctx.doi)}`;
    let res: Response;
    try {
      res = await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": `LabShelf/0.1 (mailto:${ctx.contactEmail})`,
        },
      });
    } catch {
      return undefined;
    }
    if (!res.ok) return undefined;
    const payload = (await res.json()) as CrossRefMessage;
    const links = payload.message?.link ?? [];
    // Prefer "similarity-checking" intent (full text for Turnitin etc.) then "text-mining".
    const ranked = [...links].sort((a, b) => intentScore(b) - intentScore(a));
    for (const link of ranked) {
      const isPdf = (link["content-type"] ?? "").toLowerCase().includes("pdf");
      if (isPdf && link.URL) return link.URL;
    }
    // Some publishers list the PDF without a content-type — accept any URL ending in .pdf.
    for (const link of ranked) {
      if (link.URL && /\.pdf(?:[?#]|$)/i.test(link.URL)) return link.URL;
    }
    return undefined;
  },
};

function intentScore(l: CrossRefLink): number {
  switch ((l["intended-application"] ?? "").toLowerCase()) {
    case "similarity-checking":
      return 3;
    case "text-mining":
      return 2;
    case "syndication":
      return 1;
    default:
      return 0;
  }
}
