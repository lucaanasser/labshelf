/**
 * Turns a paper already in the library into a capture draft, so the library
 * page's "Find PDF" can run the same resolver chain a fresh capture does — no
 * tab involved. Identifiers come from the stored record (its DOI, arXiv id or
 * PubMed URL); its landing page is read once for citation_pdf_url and download
 * anchors, exactly as a Scholar result's page is.
 * @depends capture/captureService (types), capture/doiDetector, capture/scholarCapture
 * @dependents background/index (paper.findPdf)
 */
import type { PaperRecord } from "@labshelf/core";
import type { CaptureDraft } from "./captureService";
import { arxivIdFromDoi, arxivIdFromUrl, cleanDoi, pmidFromUrl } from "./doiDetector";
import type { DetectedIds } from "./doiDetector";
import { readLandingPage } from "./scholarCapture";

/**
 * Identifiers a stored record reveals: its DOI, the arXiv id named by an arXiv
 * DOI or an arxiv.org URL, and a PMID in a PubMed URL.
 * @usedBy draftFromRecord, tests
 */
export function idsFromRecord(r: PaperRecord): DetectedIds {
  const doi = cleanDoi(r.doi);
  const arxivId = arxivIdFromDoi(r.doi) ?? (r.url ? arxivIdFromUrl(r.url) : undefined);
  const pmid = r.url ? pmidFromUrl(r.url) : undefined;
  return {
    ...(doi ? { doi } : {}),
    ...(arxivId ? { arxivId } : {}),
    ...(pmid ? { pmid } : {}),
  };
}

/**
 * Builds the PDF-search draft for a saved paper. The record's own identifiers
 * win over whatever the landing page states.
 * @usedBy background/index (paper.findPdf)
 */
export async function draftFromRecord(r: PaperRecord): Promise<CaptureDraft> {
  const landing = r.url ? await readLandingPage(r.url) : undefined;
  return {
    pageUrl: r.url ?? "",
    ids: { ...(landing?.ids ?? {}), ...idsFromRecord(r) },
    metadata: {},
    origin: "none",
    isPaper: true,
    pdfCandidates: landing?.pdfCandidates ?? [],
    fetchOpts: {},
    pdfAttempts: [],
    existing: r,
  };
}
