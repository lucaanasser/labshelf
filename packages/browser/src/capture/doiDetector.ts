/**
 * Pure regex/string utilities for detecting DOIs, arXiv IDs, and PMIDs from
 * URLs or free-form text (e.g. clipboard contents pasted into the library page).
 * The DOM-aware sibling lives in pageProbeContentScript.ts.
 * @depends none
 * @dependents capture/captureService, library-page/controllers/captureController
 */

// DOI: starts with 10. then a registrant prefix, slash, and suffix.
const DOI_RE = /\b(10\.\d{4,}(?:\.\d+)*\/[^\s"',<>[\]{}|^~`#%?]+)/;
// arXiv: new format (2301.12345) and URL forms (arxiv.org/abs/..., arxiv:...).
const ARXIV_RE = /(?:arxiv\.org\/(?:abs|pdf|html)\/|^arxiv:|^\s*)(\d{4}\.\d{4,5}(?:v\d+)?)/i;
// PMID: bare number in a PubMed URL, the `pmid:` scheme, or the meta value.
const PMID_RE = /(?:pubmed(?:\.ncbi\.nlm\.nih\.gov)?\/|^pmid:|^\s*)(\d{6,9})\b/i;

export interface DetectedIds {
  doi?: string;
  arxivId?: string;
  pmid?: string;
}

/**
 * Extracts identifiers from any string — URL, DOI text, "arxiv:1234.5678", "PMID: 12345".
 * Prefers arXiv over DOI when both match (arXiv landing pages embed both).
 * @usedBy capture/captureService, library-page captureController
 * @returns DetectedIds with at most one identifier set (the most specific match).
 */
export function detectIdentifiers(input: string): DetectedIds {
  const trimmed = input.trim();
  const arxiv = ARXIV_RE.exec(trimmed)?.[1];
  if (arxiv) return { arxivId: arxiv };
  const doi = DOI_RE.exec(trimmed)?.[1];
  if (doi) return { doi };
  const pmid = PMID_RE.exec(trimmed)?.[1];
  if (pmid) return { pmid };
  return {};
}
