/**
 * Orchestrates toolbar capture end-to-end:
 *   1. Probe the active tab DOM for DOI / arXiv / PMID / PDF hints.
 *   2. Resolve a working PDF URL via the resolver chain (page hints → arXiv →
 *      CrossRef → Unpaywall → Sci-Hub when opted in).
 *   3. Enrich metadata via CrossRef / arXiv.
 *   4. Download the PDF and persist everything to IndexedDB.
 *
 * The paper is queued for the next sync cycle; no Drive upload happens here.
 * @depends @labshelf/core resolveOnlineMetadata, capture/pageProbeContentScript,
 *          capture/resolvers, capture/addPaperFlow, platform/settings
 * @dependents background/index
 */
import type { DetectedIdentifier, PaperRecord, ResolvedMetadata } from "@labshelf/core";
import { resolveOnlineMetadata } from "@labshelf/core";
import { probe } from "./pageProbeContentScript";
import type { PageProbeResult } from "./pageProbeContentScript";
import { resolvePdfUrl } from "./resolvers/index";
import type { ResolveContext } from "./resolvers/index";
import { addPaper } from "./addPaperFlow";
import { getSettings } from "../platform/settings";

/** Per-paper capture outcome. */
export interface CaptureOutcome {
  paper: PaperRecord;
  pdfSource: string;
}

/**
 * Captures the paper on the given tab. Injects a DOM probe, runs the resolver
 * chain to find a working PDF URL, enriches metadata via CrossRef/arXiv, and
 * persists the result to IndexedDB. Throws if no identifier OR PDF can be found.
 * @usedBy background/index (handle "capture.activeTab" message)
 * @returns CaptureOutcome with the new PaperRecord and which resolver provided the PDF.
 */
export async function captureActiveTab(tabId: number, tabUrl: string): Promise<CaptureOutcome> {
  // When the tab is itself a PDF, skip the probe to avoid wasting an inject call.
  const probeResult: PageProbeResult = isPdfUrl(tabUrl)
    ? { pageIsPdf: true, pageUrl: tabUrl }
    : await injectProbe(tabId);

  const settings = await getSettings();
  const meta = await enrichMetadata(probeResult);

  const ctx: ResolveContext = {
    pageHints: probeResult,
    allowSciHub: settings.enableSciHub,
    contactEmail: settings.contactEmail,
    sciHubMirror: settings.sciHubMirror,
    ...(probeResult.doi ? { doi: probeResult.doi } : {}),
    ...(probeResult.arxivId ? { arxivId: probeResult.arxivId } : {}),
    ...(probeResult.pmid ? { pmid: probeResult.pmid } : {}),
    ...(meta.doi && !probeResult.doi ? { doi: meta.doi } : {}),
  };

  const resolved = await resolvePdfUrl(ctx);
  if (!resolved) {
    throw new Error(
      "Could not locate a downloadable PDF for this page" +
        (settings.enableSciHub ? "" : " — enable Sci-Hub in options for more fallback options"),
    );
  }

  const pdfBytes = await downloadPdf(resolved.url);
  const paper = await addPaper(pdfBytes, meta, probeResult.title ?? "Untitled");
  return { paper, pdfSource: resolved.source };
}

// Runs CrossRef (for DOIs) or arXiv (for arXiv IDs) to enrich the bibliographic metadata.
async function enrichMetadata(probeResult: PageProbeResult): Promise<ResolvedMetadata> {
  const id = toIdentifier(probeResult);
  if (!id) return {};
  try {
    return (await resolveOnlineMetadata(id)) ?? {};
  } catch {
    return {};
  }
}

// Picks the first detected identifier from the probe result, preferring arXiv (better metadata).
function toIdentifier(r: PageProbeResult): DetectedIdentifier | undefined {
  if (r.arxivId) return { type: "arxiv", value: r.arxivId };
  if (r.doi) return { type: "doi", value: r.doi };
  return undefined;
}

// Injects the probe function into the target tab via chrome.scripting.executeScript.
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

// Downloads the PDF bytes from the given URL.
async function downloadPdf(url: string): Promise<Uint8Array> {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`PDF download failed: HTTP ${res.status} — ${url}`);
  return new Uint8Array(await res.arrayBuffer());
}

// Direct PDF URL check used before injecting the probe.
function isPdfUrl(url: string): boolean {
  try {
    return new URL(url).pathname.toLowerCase().endsWith(".pdf");
  } catch {
    return false;
  }
}
