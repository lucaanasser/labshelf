/**
 * Page probe injected on-demand into the active tab via chrome.scripting.executeScript.
 * Extracts every bibliographic hint the page exposes: DOI, arXiv ID, PMID, multiple
 * PDF URL candidates (citation_pdf_url meta tag, link rel=alternate, direct anchor
 * tags), and the title. The probe never picks a single answer — captureService runs
 * a resolver chain that tries each hint in priority order.
 * @depends none (must not import anything — serialized via Function.toString at inject time)
 * @dependents capture/captureService
 */

/** All bibliographic hints extracted from the active page DOM. */
export interface PageProbeResult {
  doi?: string;
  arxivId?: string;
  pmid?: string;
  title?: string;
  /** PDF URL from <meta name="citation_pdf_url"> — the Google Scholar standard. */
  citationPdfUrl?: string;
  /** PDF URL from <link rel="alternate" type="application/pdf">. */
  alternatePdfUrl?: string;
  /** First <a> tag whose href ends in .pdf — site fallback. */
  directPdfUrl?: string;
  /** True when the page itself is a PDF (Content-Type or path ends in .pdf). */
  pageIsPdf?: boolean;
  /** The current page URL — used as last-resort PDF source when pageIsPdf. */
  pageUrl?: string;
}

/**
 * Inspects the active page DOM and returns all bibliographic and PDF-source hints.
 * This function is serialized via Function.prototype.toString() and injected into
 * the page by chrome.scripting.executeScript — it MUST NOT close over any imported
 * symbols and may only use browser globals (document, location, etc).
 * @usedBy capture/captureService (passed as func to scripting.executeScript)
 * @returns PageProbeResult with every detected hint.
 */
export function probe(): PageProbeResult {
  function meta(name: string): string | undefined {
    const el = document.querySelector<HTMLMetaElement>(
      `meta[name="${name}" i], meta[property="${name}" i]`,
    );
    return el?.content?.trim() || undefined;
  }

  // --- Identifiers ---
  const DOI_RE = /\b(10\.\d{4,}(?:\.\d+)*\/[^\s"',<>[\]{}|^~`#%?]+)/;
  const ARXIV_RE = /(?:arxiv\.org\/(?:abs|pdf|html)\/|arxiv:)(\d{4}\.\d{4,5}(?:v\d+)?)/i;

  const doiRaw =
    meta("citation_doi") ??
    meta("dc.identifier") ??
    meta("dc.identifier.doi") ??
    meta("prism.doi") ??
    meta("og:doi");
  const doi = (doiRaw && DOI_RE.exec(doiRaw)?.[1]) ?? DOI_RE.exec(location.href)?.[1];

  const arxivMeta = meta("citation_arxiv_id");
  const arxivId = arxivMeta ?? ARXIV_RE.exec(location.href)?.[1];

  const pmid = meta("citation_pmid") ?? /pubmed(?:\.ncbi\.nlm\.nih\.gov)?\/(\d+)/i.exec(location.href)?.[1];

  // --- Title ---
  const title = (
    meta("citation_title") ??
    meta("og:title") ??
    meta("dc.title") ??
    document.title
  ).trim() || undefined;

  // --- PDF URL candidates ---
  const citationPdfUrl = meta("citation_pdf_url");
  const alternatePdfUrl = document.querySelector<HTMLLinkElement>(
    'link[rel="alternate"][type="application/pdf"]',
  )?.href;

  // Look for the first <a href> that ends in .pdf and is on the same origin or a known publisher domain.
  function findDirectPdfLink(): string | undefined {
    const anchors = document.querySelectorAll<HTMLAnchorElement>('a[href]');
    for (const a of anchors) {
      const href = a.href;
      if (!href) continue;
      if (/\.pdf(?:[?#]|$)/i.test(href)) return href;
    }
    return undefined;
  }
  const directPdfUrl = findDirectPdfLink();

  const pageIsPdf =
    document.contentType === "application/pdf" || /\.pdf(?:[?#]|$)/i.test(location.pathname);

  // --- Build result, omitting undefined fields for exactOptionalPropertyTypes ---
  const r: PageProbeResult = { pageUrl: location.href };
  if (doi) r.doi = doi;
  if (arxivId) r.arxivId = arxivId;
  if (pmid) r.pmid = pmid;
  if (title) r.title = title;
  if (citationPdfUrl) r.citationPdfUrl = citationPdfUrl;
  if (alternatePdfUrl) r.alternatePdfUrl = alternatePdfUrl;
  if (directPdfUrl) r.directPdfUrl = directPdfUrl;
  if (pageIsPdf) r.pageIsPdf = true;
  return r;
}
