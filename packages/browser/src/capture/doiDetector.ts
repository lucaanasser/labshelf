/**
 * Pure regex/string utilities for detecting DOIs, arXiv IDs, and PMIDs in
 * URLs, meta-tag values and free text. The DOM-aware sibling lives in
 * pageProbeContentScript.ts; capture/pageFacts decides which source to trust.
 * @depends none
 * @dependents capture/pageFacts, capture/scholarCapture, content/scholarParse
 */

// DOI: starts with 10. then a registrant prefix, slash, and suffix.
const DOI_RE = /\b(10\.\d{4,}(?:\.\d+)*\/[^\s"',<>[\]{}|^`#?]+)/;
// arXiv's own DOIs (10.48550/arXiv.2301.12345) name the preprint.
const ARXIV_DOI_RE = /^10\.48550\/arxiv\.(\d{4}\.\d{4,5})(?:v\d+)?$/i;

// Path segments publishers append after the DOI in article URLs.
const URL_TAIL_RE = /\/(?:abstract|full|fulltext|pdf|epdf|pdfdirect|html|meta|references|figures|citedby|summary)$/i;

export interface DetectedIds {
  doi?: string;
  arxivId?: string;
  pmid?: string;
}

/**
 * Normalises a DOI candidate: decodes URL escapes, drops a doi.org prefix,
 * trailing punctuation, a ".pdf" suffix and publisher path tails.
 * @usedBy findDoi, capture/pageFacts
 * @returns The bare DOI, or undefined when the text holds none.
 */
export function cleanDoi(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  let text = raw;
  try { text = decodeURIComponent(raw); } catch { /* keep the raw text */ }
  let doi = DOI_RE.exec(text)?.[1];
  if (!doi) return undefined;
  doi = doi.replace(/[.,;:]+$/, "").replace(/\.pdf$/i, "");
  // "(doi:10.1/x)" — drop a closing bracket only when the DOI never opened one.
  while (/[)\]]$/.test(doi) && count(doi, "(") + count(doi, "[") < count(doi, ")") + count(doi, "]")) {
    doi = doi.slice(0, -1).replace(/[.,;:]+$/, "");
  }
  while (URL_TAIL_RE.test(doi)) doi = doi.replace(URL_TAIL_RE, "");
  return doi;
}

function count(text: string, ch: string): number {
  return text.split(ch).length - 1;
}

/** The arXiv id named by an arXiv DOI, if `doi` is one. */
export function arxivIdFromDoi(doi: string | undefined): string | undefined {
  return doi ? ARXIV_DOI_RE.exec(doi)?.[1] : undefined;
}

/** arXiv id in an arxiv.org URL. */
export function arxivIdFromUrl(url: string): string | undefined {
  return /arxiv\.org\/(?:abs|pdf|html)\/(\d{4}\.\d{4,5})(?:v\d+)?/i.exec(url)?.[1];
}

/** PubMed id in a PubMed URL. */
export function pmidFromUrl(url: string): string | undefined {
  return /pubmed\.ncbi\.nlm\.nih\.gov\/(\d{6,9})\b|ncbi\.nlm\.nih\.gov\/pubmed\/(\d{6,9})\b/i.exec(url)?.slice(1).find(Boolean);
}
