/**
 * Runs every resolver in priority order and returns the first successful PDF URL,
 * verifying that the URL actually serves a PDF (HEAD request, content-type check).
 * Resolvers that mutate context (pubmed → DOI) run first so later resolvers can
 * use the populated identifier.
 * @depends capture/resolvers/types, capture/resolvers/* (each resolver module)
 * @dependents capture/captureService
 */
import type { PdfResolver, ResolveContext, ResolvedPdf } from "./types";
import { pageHintResolver } from "./pageHintResolver";
import { arxivResolver } from "./arxivResolver";
import { crossrefResolver } from "./crossrefResolver";
import { unpaywallResolver } from "./unpaywallResolver";
import { pubmedResolver } from "./pubmedResolver";
import { sciHubResolver } from "./scihubResolver";

// Order matters: cheaper / more reliable sources run before expensive / fragile ones.
// pubmed runs first so its DOI side-effect benefits all later resolvers.
const CHAIN: PdfResolver[] = [
  pubmedResolver,
  pageHintResolver,
  arxivResolver,
  crossrefResolver,
  unpaywallResolver,
  sciHubResolver,
];

/**
 * Walks the resolver chain and returns the first PDF URL whose HEAD response
 * looks like a real PDF. Returns undefined if no resolver produced a working URL.
 * @usedBy captureService
 */
export async function resolvePdfUrl(ctx: ResolveContext): Promise<ResolvedPdf | undefined> {
  for (const resolver of CHAIN) {
    let url: string | undefined;
    try {
      url = await resolver.resolve(ctx);
    } catch {
      url = undefined;
    }
    if (!url) continue;
    if (await looksLikePdf(url)) return { url, source: resolver.name };
  }
  return undefined;
}

// HEAD-checks the URL; falls back to a GET range request when HEAD is rejected.
async function looksLikePdf(url: string): Promise<boolean> {
  try {
    const head = await fetch(url, { method: "HEAD", redirect: "follow" });
    if (head.ok && isPdfContentType(head.headers.get("content-type"))) return true;
    // Some publishers reject HEAD with 405; try a 1-byte range GET.
    if (head.status === 405 || head.status === 403) {
      const ranged = await fetch(url, { headers: { Range: "bytes=0-3" }, redirect: "follow" });
      if (!ranged.ok) return false;
      // First 4 bytes of any PDF are "%PDF".
      const text = await ranged.text();
      if (text.startsWith("%PDF")) return true;
      return isPdfContentType(ranged.headers.get("content-type"));
    }
  } catch {
    // Network or CORS error — treat as not a PDF.
  }
  return false;
}

function isPdfContentType(value: string | null): boolean {
  return !!value && value.toLowerCase().includes("application/pdf");
}
