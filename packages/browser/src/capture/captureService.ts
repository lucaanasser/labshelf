/**
 * Orchestrates toolbar capture: probes the active tab, resolves metadata via the
 * CrossRef/arXiv APIs, downloads the PDF, and persists everything to IndexedDB.
 * The paper is NOT synced immediately; the auto-sync scheduler handles upload.
 * @depends @labshelf/core resolveOnlineMetadata DetectedIdentifier,
 *          capture/pageProbeContentScript, capture/pdfUrlExtractor, capture/addPaperFlow
 * @dependents background/index
 */
import type { DetectedIdentifier, PaperRecord } from "@labshelf/core";
import { resolveOnlineMetadata } from "@labshelf/core";
import { probe } from "./pageProbeContentScript";
import type { PageProbeResult } from "./pageProbeContentScript";
import { isPdfUrl } from "./pdfUrlExtractor";
import { addPaper } from "./addPaperFlow";

/**
 * Captures the paper on the given tab: injects a DOM probe, resolves metadata,
 * downloads the PDF, and writes it to IndexedDB. Throws if nothing identifiable
 * is found or the PDF cannot be fetched.
 * @usedBy background/index (handle "capture.activeTab" message)
 * @returns The newly created PaperRecord.
 */
export async function captureActiveTab(tabId: number, tabUrl: string): Promise<PaperRecord> {
  // For direct PDF URLs the probe is unnecessary — use the URL as pdfUrl.
  const probeResult: PageProbeResult = isPdfUrl(tabUrl)
    ? { pdfUrl: tabUrl }
    : await injectProbe(tabId);

  const identifier = toIdentifier(probeResult);
  if (!identifier && !probeResult.pdfUrl) {
    throw new Error("No DOI, arXiv ID, or PDF link found on this page.");
  }

  const meta = identifier ? ((await resolveOnlineMetadata(identifier)) ?? {}) : {};

  const pdfUrl = probeResult.pdfUrl ?? derivePdfUrl(identifier);
  if (!pdfUrl) {
    throw new Error("Could not determine a PDF URL for this paper.");
  }

  const pdfBytes = await downloadPdf(pdfUrl);
  return addPaper(pdfBytes, meta, probeResult.title ?? "Untitled");
}

// Injects the probe function into the target tab via chrome.scripting.executeScript
// and returns the result. Falls back to browser.scripting for Firefox.
async function injectProbe(tabId: number): Promise<PageProbeResult> {
  // webextension-polyfill does not expose scripting; access the raw global.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scripting = (globalThis as any).chrome?.scripting ??
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).browser?.scripting;
  if (!scripting) throw new Error("scripting API unavailable");

  const results: Array<{ result: PageProbeResult }> = await (scripting.executeScript({
    target: { tabId },
    func: probe,
  }) as Promise<Array<{ result: PageProbeResult }>>);

  return results[0]?.result ?? {};
}

// Picks the first detected identifier from the probe result.
function toIdentifier(r: PageProbeResult): DetectedIdentifier | undefined {
  if (r.arxivId) return { type: "arxiv", value: r.arxivId };
  if (r.doi) return { type: "doi", value: r.doi };
  return undefined;
}

// Derives a PDF URL from a known identifier when the probe found none.
function derivePdfUrl(id: DetectedIdentifier | undefined): string | undefined {
  if (!id) return undefined;
  // arXiv provides a stable PDF URL; DOIs do not.
  if (id.type === "arxiv") return `https://arxiv.org/pdf/${id.value}.pdf`;
  return undefined;
}

// Downloads the PDF bytes from the given URL.
async function downloadPdf(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`PDF download failed: HTTP ${res.status} — ${url}`);
  return new Uint8Array(await res.arrayBuffer());
}
