/**
 * Last resort for a PDF behind a bot check: open the publisher's site in a
 * background tab, let the browser itself pass the check (Cloudflare's
 * challenge resolves on its own in a real page load), then fetch the PDF
 * from inside that tab with the clearance it just earned, and close the tab.
 * The tab is inactive, so the user's focus — and the popup — stay put.
 * @depends platform/browserApi, capture/pdfFetcher
 * @dependents capture/captureService
 */
import { bx } from "../platform/browserApi";
import { fetchInTab, fetchPdf, nextHopsFromHtml } from "./pdfFetcher";
import type { FetchedPdf } from "./pdfFetcher";

const SETTLE_TIMEOUT_MS = 15_000;
const POLL_MS = 600;

/**
 * Loads the site of `urls[0]` in a background tab and downloads, from it, the
 * first of `urls` on that site that is a PDF.
 * @usedBy capture/captureService (as PdfFetchOptions.viaHelperTab)
 * @returns The PDF, or undefined when the site still refuses.
 */
export async function fetchViaHelperTab(urls: string[]): Promise<FetchedPdf | undefined> {
  const origin = originOf(urls[0]);
  if (!origin) return undefined;
  const tab = await bx.tabs.create({ url: `${origin}/`, active: false });
  if (tab.id === undefined) return undefined;
  try {
    if (!(await settled(tab.id))) return undefined;
    for (const url of urls.filter((u) => originOf(u) === origin)) {
      const answer = await fetchInTab(tab.id, url);
      if (answer?.pdf) return answer.pdf;
      // An interstitial: its target (often a signed CDN link) usually downloads
      // from the background; otherwise try it from the tab too.
      for (const hop of answer?.html ? nextHopsFromHtml(answer.html, answer.finalUrl) : []) {
        const pdf = (await fetchPdf(hop)) ?? (originOf(hop) === origin ? (await fetchInTab(tab.id, hop))?.pdf : undefined);
        if (pdf) return pdf;
      }
    }
    return undefined;
  } finally {
    await bx.tabs.remove(tab.id).catch(() => undefined);
  }
}

function originOf(url: string | undefined): string | undefined {
  try { return url ? new URL(url).origin : undefined; } catch { return undefined; }
}

// Waits until the tab shows a real page — not a bot check, not the blank
// document a challenge passes through while it reloads — on two polls in a row.
async function settled(tabId: number): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scripting = (globalThis as any).chrome?.scripting ?? (globalThis as any).browser?.scripting;
  if (!scripting) return false;
  const deadline = Date.now() + SETTLE_TIMEOUT_MS;
  let calm = 0;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    try {
      const [first] = (await scripting.executeScript({ target: { tabId }, func: pageState })) as Array<{ result?: { ready: boolean; challenge: boolean } }>;
      calm = first?.result?.ready && !first.result.challenge ? calm + 1 : 0;
      if (calm >= 2) return true;
    } catch {
      // Not injectable yet (still navigating): keep waiting.
      calm = 0;
    }
  }
  return false;
}

// Runs in the tab (serialized): must not reference anything outside itself.
function pageState(): { ready: boolean; challenge: boolean } {
  const text = `${document.title} ${document.body?.innerText?.slice(0, 2000) ?? ""}`;
  return {
    ready: document.readyState === "complete" && document.title.trim() !== "",
    challenge: /just a moment|checking your browser|attention required|verify you are human|um momento|cf-chl/i.test(text) ||
      /__cf_chl/.test(location.href) ||
      !!document.querySelector("#challenge-form, #challenge-stage, #cf-challenge-running, .cf-browser-verification, iframe[src*='challenges.cloudflare.com']"),
  };
}
