/**
 * Reads Google Scholar result blocks (div.gs_r.gs_or) into ScholarHit records:
 * the title without Scholar's "[PDF]" / "[BOOK]" markers, the landing link,
 * the right-column "[PDF]" link, and the green line under the title —
 * "A Aggarwal, M Klawe… - Proceedings of the …, 1986 - dl.acm.org" — split
 * into authors, venue, year.
 * @depends capture/doiDetector, platform/runtimeMessages (types)
 * @dependents content/scholar
 */
import { arxivIdFromUrl, cleanDoi } from "../capture/doiDetector";
import type { LookupItem, ScholarHit } from "../platform/runtimeMessages";

// Google Scholar's own hosts: scholar.google.com and its country domains
// (.com.br, .co.uk, .de, …). The manifest glob "scholar.google.*" alone would
// also match scholar.google.<anything>.com.
const SCHOLAR_HOST = /^scholar\.google\.(?:com|[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2})$/;

/**
 * True for a Google Scholar page URL.
 * @usedBy content/scholar, background/index (sender check), tests
 */
export function isScholarUrl(url: string | undefined): boolean {
  try {
    const u = new URL(url ?? "");
    return u.protocol === "https:" && SCHOLAR_HOST.test(u.hostname);
  } catch {
    return false;
  }
}

export interface AuthorsLine {
  authors: string[];
  venue?: string;
  year?: number;
  host?: string;
}

/**
 * Splits Scholar's byline: "authors - venue, year - source". The source (a
 * domain or a publisher name) is the last of three or more segments, or a
 * lone second segment that looks like a domain; authors may end in "…".
 * @usedBy readResult, tests
 */
export function parseAuthorsLine(text: string): AuthorsLine {
  const parts = text.replace(/\u00a0/g, " ").split(/\s+[-–]\s+/).map((p) => p.trim()).filter(Boolean);
  const out: AuthorsLine = { authors: [] };
  if (!parts.length) return out;

  const last = parts[parts.length - 1]!;
  if (parts.length > 2 || (parts.length === 2 && /^[\w.-]+\.[a-z]{2,}$/i.test(last))) {
    out.host = last;
    parts.pop();
  }
  out.authors = (parts.shift() ?? "")
    .split(",")
    .map((a) => a.replace(/…|\.\.\.$/g, "").trim())
    .filter((a) => a && /[a-z]/i.test(a));

  const middle = parts.join(" - ");
  const year = /\b(1[5-9]\d\d|20\d\d)\b(?!.*\b(1[5-9]\d\d|20\d\d)\b)/.exec(middle)?.[1];
  if (year) out.year = Number(year);
  const venue = middle.replace(/,?\s*\b(1[5-9]\d\d|20\d\d)\b\s*$/, "").replace(/[,\s]+$/, "").trim();
  if (venue && venue !== year) out.venue = venue;
  return out;
}

/**
 * Reads one result block; undefined for blocks that are not results
 * (author profiles, "related searches").
 * @usedBy content/scholar
 */
export function readResult(el: Element): ScholarHit | undefined {
  const heading = el.querySelector("h3.gs_rt");
  if (!heading) return undefined;
  const titleNode = heading.cloneNode(true) as Element;
  titleNode.querySelectorAll(".gs_ctc, .gs_ctu, .gs_ctg, .gs_ctg2").forEach((n) => n.remove());
  const title = (titleNode.textContent ?? "").replace(/\s+/g, " ").trim();
  if (!title) return undefined;

  const link = heading.querySelector<HTMLAnchorElement>("a[href]");
  const pdfAnchor = [...el.querySelectorAll<HTMLAnchorElement>(".gs_or_ggsm a[href], .gs_ggsd a[href]")]
    .find((a) => /\[pdf\]/i.test(a.querySelector(".gs_ctg2")?.textContent ?? "") || /\.pdf(?:[?#]|$)/i.test(a.href));
  const line = parseAuthorsLine(el.querySelector(".gs_a")?.textContent ?? "");
  const key = (el as HTMLElement).dataset?.["cid"] || (el as HTMLElement).dataset?.["did"] || link?.id || title;

  const hit: ScholarHit = { key, title, authors: line.authors };
  if (link?.href && /^https?:/.test(link.href)) hit.url = link.href;
  if (pdfAnchor?.href && /^https?:/.test(pdfAnchor.href)) hit.pdfUrl = pdfAnchor.href;
  if (line.venue) hit.venue = line.venue;
  if (line.year) hit.year = line.year;
  return hit;
}

/**
 * What the library lookup needs to recognise a result.
 * @usedBy content/scholar, tests
 */
export function lookupItemFor(hit: ScholarHit): LookupItem {
  const urls = [hit.url, hit.pdfUrl].filter((u): u is string => !!u);
  const doi = urls.map((u) => cleanDoi(u)).find(Boolean);
  const arxivId = urls.map(arxivIdFromUrl).find(Boolean);
  return {
    key: hit.key,
    title: hit.title,
    ...(hit.year ? { year: hit.year } : {}),
    ...(doi ? { doi } : {}),
    ...(arxivId ? { arxivId } : {}),
  };
}
