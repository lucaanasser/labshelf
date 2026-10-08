/**
 * Reads HTML the background fetched itself (a Scholar result's landing page, a
 * publisher's "your PDF is loading" interstitial) into the same RawPage shape
 * the in-tab probe produces. The MV3 service worker has no DOMParser, so this
 * is deliberately a tolerant regex reader of the few tags that matter.
 * @depends capture/pageProbeContentScript (types only)
 * @dependents capture/pdfFetcher, capture/scholarCapture
 */
import type { RawPage, RawPdfLink } from "./pageProbeContentScript";

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Decodes the HTML entities that show up in attribute values. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

// Attributes of one tag, keys lower-cased, values entity-decoded.
function attributes(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
    out[m[1]!.toLowerCase()] = decodeEntities(m[3] ?? m[4] ?? m[5] ?? "");
  }
  return out;
}

function absolute(raw: string | undefined, base: string): string | undefined {
  if (!raw || /^(javascript|blob|data):/i.test(raw)) return undefined;
  try {
    const url = new URL(raw.trim(), base).href;
    return /^https?:/.test(url) ? url : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Parses meta tags, PDF links/viewers and DOI links out of an HTML document.
 * @usedBy capture/pdfFetcher, capture/scholarCapture
 * @returns RawPage for capture/pageFacts.interpretPage
 */
export function parseHtmlPage(html: string, pageUrl: string): RawPage {
  const meta: Record<string, string[]> = {};
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const a = attributes(m[0]);
    const key = (a["name"] ?? a["property"] ?? "").trim().toLowerCase();
    const value = (a["content"] ?? "").trim();
    if (key && value) (meta[key] ??= []).push(value);
  }

  const pdfLinks: RawPdfLink[] = [];
  const seen = new Set<string>();
  const add = (raw: string | undefined, kind: RawPdfLink["kind"]): void => {
    const url = absolute(raw, pageUrl);
    if (!url || seen.has(url)) return;
    seen.add(url);
    pdfLinks.push({ url, kind });
  };

  for (const m of html.matchAll(/<(embed|iframe|object)\b[^>]*>/gi)) {
    const a = attributes(m[0]);
    const src = a["src"] ?? a["data"];
    if (a["type"] === "application/pdf" || (src && /\.pdf|\/pdf/i.test(src))) add(src, "embed");
  }
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const a = attributes(m[0]);
    if ((a["rel"] ?? "").toLowerCase() === "alternate" && a["type"] === "application/pdf") add(a["href"], "alternate");
  }
  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]{0,300}?)<\/a>/gi)) {
    const a = attributes(m[1] ?? "");
    const href = a["href"];
    if (!href) continue;
    const label = `${(m[2] ?? "").replace(/<[^>]+>/g, " ")} ${a["title"] ?? ""} ${a["aria-label"] ?? ""} ${a["class"] ?? ""}`;
    if (a["type"] === "application/pdf" || /(^|[^a-z])pdf([^a-z]|$)/i.test(label)) add(href, "labelled");
    else if (/\.pdf(?:[?#]|$)|\/pdf(?:direct|ft)?\/|\/epdf\//i.test(href)) add(href, "href");
  }

  const doiLinks = [...html.matchAll(/href\s*=\s*["']([^"']*doi\.org\/10\.[^"']+)["']/gi)]
    .map((m) => decodeEntities(m[1]!))
    .slice(0, 20);

  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  const raw: RawPage = { pageUrl, meta, pdfLinks: pdfLinks.slice(0, 40), doiLinks };
  const documentTitle = title ? decodeEntities(title.replace(/\s+/g, " ").trim()) : "";
  if (documentTitle) raw.documentTitle = documentTitle;
  return raw;
}

/**
 * Where an interstitial page sends the browser next: a meta refresh or a
 * scripted location change. Publishers (ScienceDirect's "pdfft" page, for
 * one) answer the PDF link with such a page instead of the file.
 * @usedBy capture/pdfFetcher
 * @returns Absolute redirect targets, most explicit first.
 */
export function redirectTargets(html: string, pageUrl: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<meta\b[^>]*http-equiv\s*=\s*["']?refresh[^>]*>/gi)) {
    const content = attributes(m[0])["content"] ?? "";
    const target = /url\s*=\s*['"]?([^'"]+)/i.exec(content)?.[1];
    const url = absolute(target, pageUrl);
    if (url) out.push(url);
  }
  for (const m of html.matchAll(/(?:window\.|document\.)?location(?:\.href)?\s*=\s*["']([^"']+)["']|location\.(?:replace|assign)\(\s*["']([^"']+)["']/g)) {
    const url = absolute(decodeEntities(m[1] ?? m[2] ?? ""), pageUrl);
    if (url) out.push(url);
  }
  return [...new Set(out)];
}
