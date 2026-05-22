/**
 * Page probe injected on-demand into the active tab via chrome.scripting.executeScript.
 * Reads the DOM to extract bibliographic identifiers and a PDF link without broad host permissions.
 * @depends none (must not import anything — serialized via Function.toString at inject time)
 * @dependents capture/captureService
 */

/** Data returned by the page probe after inspecting the active tab's DOM. */
export interface PageProbeResult {
  doi?: string;
  arxivId?: string;
  pdfUrl?: string;
  title?: string;
}

/**
 * Reads the current page DOM for DOI/arXiv identifiers, a PDF link, and the paper title.
 * This function is serialized via Function.prototype.toString() and injected by
 * chrome.scripting.executeScript — it MUST NOT close over any imported symbols.
 * @usedBy capture/captureService (passed as func to scripting.executeScript)
 * @returns PageProbeResult extracted from the live DOM.
 */
export function probe(): PageProbeResult {
  function q<T extends Element>(selector: string): T | null {
    return document.querySelector<T>(selector);
  }

  // DOI from common meta tags, then fall back to URL.
  const doiMeta =
    q<HTMLMetaElement>('meta[name="citation_doi"]')?.content ??
    q<HTMLMetaElement>('meta[name="dc.identifier"]')?.content ??
    q<HTMLMetaElement>('meta[property="og:doi"]')?.content;

  const DOI_RE = /\b(10\.\d{4,}(?:\.\d+)*\/[^\s"',<>[\]{}|^~`#%?]+)/;
  const doi =
    doiMeta ? DOI_RE.exec(doiMeta)?.[1] : DOI_RE.exec(location.href)?.[1];

  // arXiv ID from the URL path (new-format: YYMM.NNNNN).
  const ARXIV_RE = /arxiv\.org\/(?:abs|pdf|html)\/(\d{4}\.\d{4,5}(?:v\d+)?)/i;
  const arxivId = ARXIV_RE.exec(location.href)?.[1];

  // PDF URL from a <link rel="alternate" type="application/pdf"> element.
  const pdfLink = q<HTMLLinkElement>('link[rel="alternate"][type="application/pdf"]')?.href;
  const pdfUrl = pdfLink ?? undefined;

  // Title from citation meta tags, then og:title, then document.title.
  const metaTitle =
    q<HTMLMetaElement>('meta[name="citation_title"]')?.content ??
    q<HTMLMetaElement>('meta[property="og:title"]')?.content ??
    q<HTMLMetaElement>('meta[name="dc.title"]')?.content;
  const title = (metaTitle ?? document.title).trim() || undefined;

  const result: PageProbeResult = {};
  if (doi) result.doi = doi;
  if (arxivId) result.arxivId = arxivId;
  if (pdfUrl) result.pdfUrl = pdfUrl;
  if (title) result.title = title;
  return result;
}
