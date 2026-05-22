/**
 * Sci-Hub fallback resolver. Disabled by default; users must opt in via the
 * options page. When enabled, fetches the configured mirror's DOI page, parses
 * the embedded PDF URL from common Sci-Hub markup patterns, and returns it.
 *
 * Mirrors and DOM patterns shift over time — this resolver is intentionally
 * lenient and returns undefined on any failure so the chain can fall through.
 * @depends capture/resolvers/types
 * @dependents capture/resolvers/resolverChain
 */
import type { PdfResolver, ResolveContext } from "./types";

export const sciHubResolver: PdfResolver = {
  name: "sci-hub",
  async resolve(ctx: ResolveContext): Promise<string | undefined> {
    if (!ctx.allowSciHub || !ctx.doi) return undefined;
    const mirror = ctx.sciHubMirror.replace(/\/+$/, "");
    const pageUrl = `${mirror}/${ctx.doi}`;
    let html: string;
    try {
      const res = await fetch(pageUrl, { redirect: "follow" });
      if (!res.ok) return undefined;
      const ctype = res.headers.get("content-type") ?? "";
      // Some mirrors serve the PDF directly under /<doi> when they have it cached.
      if (ctype.toLowerCase().includes("pdf")) return res.url;
      html = await res.text();
    } catch {
      return undefined;
    }

    // Try common embed markup: <embed src="...">, <iframe src="...">, location.href = "..."
    const candidates = [
      /<embed[^>]+src\s*=\s*["']([^"']+\.pdf[^"']*)["']/i,
      /<iframe[^>]+src\s*=\s*["']([^"']+\.pdf[^"']*)["']/i,
      /location\.href\s*=\s*["']([^"']+\.pdf[^"']*)["']/i,
      /<a[^>]+href\s*=\s*["']([^"']+\.pdf[^"']*)["'][^>]*>(?:[^<]*?download)/i,
    ];
    for (const re of candidates) {
      const m = re.exec(html);
      const raw = m?.[1];
      if (raw) return normaliseSciHubUrl(raw, mirror);
    }
    return undefined;
  },
};

// Sci-Hub often returns protocol-relative ("//host/path.pdf") or root-relative ("/path.pdf") URLs.
function normaliseSciHubUrl(raw: string, mirror: string): string {
  if (raw.startsWith("//")) return `https:${raw}`;
  if (raw.startsWith("/")) return `${mirror}${raw}`;
  return raw;
}
