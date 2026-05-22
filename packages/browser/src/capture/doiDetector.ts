/**
 * Extracts DOI and arXiv identifiers from a URL string.
 * Used by captureService to derive an identifier before injecting the page probe.
 * @depends none
 * @dependents capture/captureService
 */

// Matches a DOI starting with 10. followed by registrant/suffix.
const DOI_RE = /\b(10\.\d{4,}(?:\.\d+)*\/[^\s"',<>[\]{}|^~`#%?]+)/;

// Matches arXiv IDs in the standard new-format URL path (YYMM.NNNNN).
const ARXIV_RE = /arxiv\.org\/(?:abs|pdf|html)\/(\d{4}\.\d{4,5}(?:v\d+)?)/i;

export interface DetectedIds {
  doi?: string;
  arxivId?: string;
}

/**
 * Extracts a DOI or arXiv identifier from the given URL string.
 * arXiv takes priority because the arXiv landing page also contains a DOI link.
 * @usedBy capture/captureService
 * @returns DetectedIds with at most one identifier set.
 */
export function idsFromUrl(url: string): DetectedIds {
  const arxivMatch = ARXIV_RE.exec(url);
  if (arxivMatch?.[1]) return { arxivId: arxivMatch[1] };
  const doiMatch = DOI_RE.exec(url);
  if (doiMatch?.[1]) return { doi: doiMatch[1] };
  return {};
}
