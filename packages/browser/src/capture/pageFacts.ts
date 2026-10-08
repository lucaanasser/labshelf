/**
 * Turns the raw evidence of a page (RawPage — from the in-tab probe or from
 * HTML the background fetched) into what capture needs: the paper's
 * identifiers, the bibliographic fields the page states in its citation_* /
 * Dublin Core / PRISM meta tags, and the PDF links worth trying, best first.
 *
 * These are the tags Google Scholar itself indexes, so every serious
 * publisher emits them; they carry journal, volume, issue, pages, ISSN and
 * the full author list even when a registry lookup fails.
 * @depends @labshelf/core ResolvedMetadata, capture/doiDetector, capture/pageProbeContentScript (types)
 * @dependents capture/captureService, capture/scholarCapture, capture/pdfFetcher
 */
import type { ResolvedMetadata } from "@labshelf/core";
import { arxivIdFromDoi, arxivIdFromUrl, cleanDoi, pmidFromUrl } from "./doiDetector";
import type { DetectedIds } from "./doiDetector";
import type { RawPage } from "./pageProbeContentScript";

/** A URL that may serve the paper's PDF, and who suggested it (shown to the user). */
export interface PdfCandidate {
  url: string;
  source: string;
}

export interface PageFacts {
  pageUrl: string;
  ids: DetectedIds;
  /** Fields the page itself states; empty when it states none. */
  metadata: ResolvedMetadata;
  /** True when the metadata came from structured citation tags, not just the page title. */
  structured: boolean;
  /** PDF links found on the page, most trustworthy first. */
  pdfCandidates: PdfCandidate[];
  /** The page is a scholarly work: it names an identifier, states citation tags, or is a PDF. */
  isPaper: boolean;
}

// Links whose URL says they are not the article itself.
const NOT_THE_ARTICLE = /supp|suppl|supplement|appendix|figure|poster|slides|review_history|license|terms|guide|instruction|author-?info|policy|catalog|brochure/i;
const MAX_ANCHOR_CANDIDATES = 4;

/**
 * Interprets a RawPage.
 * @usedBy capture/captureService, capture/scholarCapture
 * @returns PageFacts
 */
export function interpretPage(raw: RawPage): PageFacts {
  const m = (...keys: string[]): string | undefined => {
    for (const key of keys) {
      const value = raw.meta[key]?.find((v) => v.trim());
      if (value) return value.trim();
    }
    return undefined;
  };
  const all = (...keys: string[]): string[] => keys.flatMap((key) => raw.meta[key] ?? []).map((v) => v.trim()).filter(Boolean);

  const ids = identifiersOf(raw, m);
  const structured = !!m("citation_title", "dc.title", "prism.title", "bepress_citation_title");

  const metadata: ResolvedMetadata = {};
  const title = m("citation_title", "dc.title", "prism.title", "bepress_citation_title") ??
    (ids.doi || ids.arxivId ? m("og:title", "twitter:title") : undefined) ??
    raw.documentTitle;
  if (title) metadata.title = squash(title);

  const authors = authorsOf(all("citation_author", "bepress_citation_author"), all("dc.creator", "dcterms.creator"), m("citation_authors"));
  if (authors.length) metadata.authors = authors;

  const year = yearOf(m("citation_publication_date", "citation_date", "citation_cover_date", "citation_online_date", "citation_year",
    "prism.publicationdate", "prism.coverdate", "dc.date", "dcterms.issued", "dc.date.issued", "article:published_time"));
  if (year) metadata.year = year;

  setIf(metadata, "journal", m("citation_journal_title", "citation_conference_title", "citation_inbook_title", "citation_book_title",
    "prism.publicationname", "bepress_citation_journal_title", "citation_series_title"));
  setIf(metadata, "publisher", m("citation_publisher", "dc.publisher", "dcterms.publisher", "bepress_citation_publisher"));
  setIf(metadata, "volume", m("citation_volume", "prism.volume", "bepress_citation_volume"));
  setIf(metadata, "issue", m("citation_issue", "prism.number", "prism.issueidentifier", "bepress_citation_issue"));
  setIf(metadata, "pages", pagesOf(m("citation_firstpage", "prism.startingpage", "bepress_citation_firstpage"),
    m("citation_lastpage", "prism.endingpage", "bepress_citation_lastpage")));
  setIf(metadata, "issn", m("citation_issn", "prism.issn", "citation_eissn", "prism.eissn"));
  setIf(metadata, "language", m("citation_language", "dc.language", "dcterms.language"));
  setIf(metadata, "summary", m("citation_abstract", "dc.description.abstract", "dcterms.abstract", "dc.description"));
  if (ids.doi) metadata.doi = ids.doi;
  const landing = m("citation_abstract_html_url", "citation_fulltext_html_url", "og:url");
  if (raw.pageIsPdf) setIf(metadata, "url", landing);
  else setIf(metadata, "url", landing ?? raw.pageUrl);
  const keywords = keywordsOf(all("citation_keywords", "dc.subject", "keywords"));
  if (keywords.length) metadata.keywords = keywords;

  const pdfCandidates = pdfCandidatesOf(raw, all("citation_pdf_url", "bepress_citation_pdf_url", "eprints.document_url"), ids);
  const isPaper = !!(ids.doi || ids.arxivId || ids.pmid || structured || raw.pageIsPdf ||
    raw.pdfLinks.some((l) => l.kind === "embed"));

  return { pageUrl: raw.pageUrl, ids, metadata, structured, pdfCandidates, isPaper };
}

function identifiersOf(raw: RawPage, m: (...keys: string[]) => string | undefined): DetectedIds {
  const ids: DetectedIds = {};
  // dc.identifier may hold an ISBN or a URL, so take the first value that is a DOI.
  const metaDoi = ["citation_doi", "dc.identifier.doi", "prism.doi", "bepress_citation_doi", "doi", "dc.identifier", "dcterms.identifier", "og:doi"]
    .flatMap((key) => raw.meta[key] ?? [])
    .map((value) => cleanDoi(value))
    .find((d): d is string => !!d);
  // A page cites many DOIs in its references; a lone doi.org link is its own.
  const linkDois = [...new Set(raw.doiLinks.map((l) => cleanDoi(l)).filter((d): d is string => !!d).map((d) => d.toLowerCase()))];
  const doi = metaDoi ?? cleanDoi(raw.pageUrl) ?? (linkDois.length === 1 ? cleanDoi(raw.doiLinks[0]) : undefined);
  if (doi) ids.doi = doi;
  const arxivId = m("citation_arxiv_id") ?? arxivIdFromUrl(raw.pageUrl) ?? arxivIdFromDoi(doi);
  if (arxivId) ids.arxivId = arxivId.replace(/^arxiv:/i, "").replace(/v\d+$/, "");
  const pmid = m("citation_pmid") ?? pmidFromUrl(raw.pageUrl);
  if (pmid && /^\d{6,9}$/.test(pmid)) ids.pmid = pmid;
  return ids;
}

function pdfCandidatesOf(raw: RawPage, metaPdfUrls: string[], ids: DetectedIds): PdfCandidate[] {
  const out: PdfCandidate[] = [];
  const seen = new Set<string>();
  const add = (url: string | undefined): void => {
    if (!url) return;
    let abs: string;
    try { abs = new URL(url, raw.pageUrl).href; } catch { return; }
    if (!/^https?:/.test(abs) || seen.has(abs)) return;
    seen.add(abs);
    out.push({ url: abs, source: "page" });
  };

  if (raw.pageIsPdf) add(raw.pageUrl);
  raw.pdfLinks.filter((l) => l.kind === "embed").forEach((l) => add(l.url));
  metaPdfUrls.forEach(add);
  raw.pdfLinks.filter((l) => l.kind === "alternate").forEach((l) => add(l.url));

  // Plain anchors are a weaker signal: keep the ones that name this paper or sit
  // on the publisher's own host, never ones that are plainly something else.
  const host = hostOf(raw.pageUrl);
  const own = [ids.doi, ids.arxivId].filter((x): x is string => !!x).map((x) => x.toLowerCase());
  const anchors = raw.pdfLinks
    .filter((l) => l.kind === "labelled" || l.kind === "href")
    .filter((l) => !NOT_THE_ARTICLE.test(l.url))
    .filter((l) => own.some((id) => safeDecode(l.url).toLowerCase().includes(id)) || hostOf(l.url) === host)
    .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "labelled" ? -1 : 1))
    .slice(0, MAX_ANCHOR_CANDIDATES);
  anchors.forEach((l) => add(l.url));
  return out;
}

/** Normalises authors to "Given Family", whichever form the page used. */
export function authorsOf(citationAuthors: string[], dcCreators: string[], joined?: string): string[] {
  let list = citationAuthors.length ? citationAuthors : dcCreators;
  if (!list.length && joined) list = joined.split(/\s*;\s*/);
  const out: string[] = [];
  for (const raw of list) {
    const name = squash(raw);
    if (!name) continue;
    const comma = /^([^,]+),\s*(.+)$/.exec(name);
    const flipped = comma ? `${comma[2]} ${comma[1]}` : name;
    if (!out.includes(flipped)) out.push(flipped);
  }
  return out;
}

/** First plausible publication year in a date string. */
export function yearOf(value: string | undefined): number | undefined {
  const match = value ? /\b(1[5-9]\d\d|20\d\d)\b/.exec(value)?.[1] : undefined;
  return match ? Number(match) : undefined;
}

/** "45" + "56" → "45-56"; a single page stays as is. */
export function pagesOf(first: string | undefined, last: string | undefined): string | undefined {
  if (!first) return undefined;
  return last && last !== first ? `${first}-${last}` : first;
}

function keywordsOf(values: string[]): string[] {
  const out: string[] = [];
  for (const v of values) {
    for (const k of v.split(/\s*[;,]\s*/)) {
      const kw = squash(k);
      if (kw && kw.length <= 80 && !out.some((x) => x.toLowerCase() === kw.toLowerCase())) out.push(kw);
    }
  }
  return out.slice(0, 20);
}

function setIf<K extends keyof ResolvedMetadata>(target: ResolvedMetadata, key: K, value: string | undefined): void {
  const v = value ? squash(value) : "";
  if (v) (target as Record<string, unknown>)[key] = v;
}

function squash(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function hostOf(url: string): string {
  try { return new URL(url).hostname; } catch { return ""; }
}

function safeDecode(url: string): string {
  try { return decodeURIComponent(url); } catch { return url; }
}
