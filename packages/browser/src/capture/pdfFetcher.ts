/**
 * Downloads a candidate URL and proves it is the PDF by its bytes ("%PDF-"),
 * never by headers: publishers answer a PDF link with a login page, a
 * cookie wall or a "your PDF is loading" interstitial as often as with the
 * file, and a HEAD request cannot tell those apart.
 *
 * Requests carry the user's cookies (credentials: "include"), so a paper the
 * user can open through an institutional login downloads the same way. When
 * the background request still lands on HTML, the HTML is read for where the
 * PDF actually is (an embedded viewer, citation_pdf_url, a meta refresh or a
 * scripted redirect) and that is followed, a few hops at most. As a last
 * resort a URL on the tab's own site is fetched from inside the tab, which
 * reproduces the page's exact session.
 *
 * Publishers behind a bot check (Cloudflare's "Just a moment…", Akamai's
 * "Access Denied") refuse any request that is not a real page load. Such
 * URLs are reported in `blocked`, and the caller may retry them through
 * `viaHelperTab` — a background tab where the browser itself passes the check.
 * @depends capture/htmlPage, capture/pageFacts, capture/pdfBytes
 * @dependents capture/resolvers/resolverChain
 */
import { parseHtmlPage, redirectTargets } from "./htmlPage";
import { interpretPage } from "./pageFacts";
import { isPdfBytes } from "./pdfBytes";

// Re-exported so existing importers (and library-page, which wants only the
// byte check) keep a single entry point.
export { isPdfBytes };

export interface FetchedPdf {
  bytes: Uint8Array;
  /** Final URL after redirects and interstitial hops. */
  url: string;
}

export interface PdfFetchOptions {
  /** Tab whose session may be borrowed for same-site URLs. */
  tabId?: number;
  tabUrl?: string;
  /** Collects URLs that answered with a bot check instead of content. */
  blocked?: string[];
  /** Loads URLs of one site through a real (background) tab; supplied by the extension runtime. */
  viaHelperTab?: (urls: string[]) => Promise<FetchedPdf | undefined>;
}

const MAX_HOPS = 3;
const MAX_PDF_BYTES = 120 * 1024 * 1024;
const MAX_HTML_BYTES = 4 * 1024 * 1024;
const TIMEOUT_MS = 45_000;

/**
 * Where an HTML answer to a PDF request points next, best guess first.
 * @usedBy fetchPdf
 */
export function nextHopsFromHtml(html: string, url: string): string[] {
  const facts = interpretPage(parseHtmlPage(html, url));
  const hops = [
    ...redirectTargets(html, url),
    ...facts.pdfCandidates.map((c) => c.url),
  ];
  return [...new Set(hops)].filter((u) => u !== url).slice(0, 4);
}

/**
 * Fetches `url` (and at most MAX_HOPS interstitials behind it) until a PDF.
 * @usedBy capture/resolvers/resolverChain
 * @returns The PDF bytes and final URL, or undefined when the URL leads to no PDF.
 */
export async function fetchPdf(url: string, opts: PdfFetchOptions = {}): Promise<FetchedPdf | undefined> {
  const visited = new Set<string>();
  let frontier = [url];
  for (let hop = 0; hop <= MAX_HOPS && frontier.length; hop++) {
    const next: string[] = [];
    for (const target of frontier) {
      if (visited.has(target)) continue;
      visited.add(target);
      const answer = await fetchOnce(target);
      if (answer?.pdf) return answer.pdf;
      if (answer?.blocked) opts.blocked?.push(target);
      else if (answer?.html) next.push(...nextHopsFromHtml(answer.html, answer.finalUrl));
      if (opts.tabId !== undefined && sameSite(target, opts.tabUrl)) {
        const inTab = await fetchInTab(opts.tabId, target);
        if (inTab?.pdf) return inTab.pdf;
        if (inTab?.html) next.push(...nextHopsFromHtml(inTab.html, inTab.finalUrl));
      }
    }
    frontier = next.filter((u) => !visited.has(u));
  }
  return undefined;
}

interface FetchAnswer {
  finalUrl: string;
  pdf?: FetchedPdf;
  html?: string;
  blocked?: boolean;
}

const BOT_CHECK = /just a moment|attention required|checking your browser|cf-browser-verification|challenge-platform|cf_chl_|cloudflare|captcha|access denied|are you a robot|unusual traffic|problem providing the content/i;

/**
 * True when a response is a bot check rather than the publisher's answer.
 * @usedBy fetchOnce, tests
 */
export function isBotCheck(status: number, html: string): boolean {
  if (status !== 403 && status !== 429 && status !== 503 && status !== 202) return false;
  // Block pages inline whole font files first; the telling words come after.
  return BOT_CHECK.test(html.replace(/<style[\s\S]*?<\/style>/gi, ""));
}

async function fetchOnce(url: string): Promise<FetchAnswer | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { credentials: "include", redirect: "follow", signal: controller.signal });
    if (!res.ok || res.status === 202) {
      const text = await res.text().catch(() => "");
      return isBotCheck(res.status, text) ? { finalUrl: res.url || url, blocked: true } : undefined;
    }
    const declared = Number(res.headers.get("content-length") ?? "0");
    if (declared > MAX_PDF_BYTES) return undefined;
    const bytes = new Uint8Array(await res.arrayBuffer());
    const finalUrl = res.url || url;
    if (isPdfBytes(bytes)) return { finalUrl, pdf: { bytes, url: finalUrl } };
    const type = (res.headers.get("content-type") ?? "").toLowerCase();
    if (bytes.length <= MAX_HTML_BYTES && (type.includes("html") || type === "")) {
      return { finalUrl, html: new TextDecoder().decode(bytes) };
    }
    return { finalUrl };
  } catch {
    // Network error, CORS refusal or timeout: the caller tries the next source.
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

function sameSite(url: string, tabUrl: string | undefined): boolean {
  if (!tabUrl) return false;
  try {
    const a = new URL(url).hostname.split(".").slice(-2).join(".");
    const b = new URL(tabUrl).hostname.split(".").slice(-2).join(".");
    return a === b;
  } catch {
    return false;
  }
}

/** What a fetch made from inside a tab came back with. */
export interface InTabAnswer {
  finalUrl: string;
  pdf?: FetchedPdf;
  /** The HTML answer (an interstitial, a viewer page), for the caller to read for next hops. */
  html?: string;
}

/**
 * Fetches `url` from inside the tab — same origin, same cookies, same bot
 * clearance as the page the user is looking at — and hands the bytes back
 * base64-encoded (script results must be JSON).
 * @usedBy fetchPdf, capture/helperTab
 */
export async function fetchInTab(tabId: number, url: string): Promise<InTabAnswer | undefined> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scripting = (globalThis as any).chrome?.scripting ?? (globalThis as any).browser?.scripting;
  if (!scripting) return undefined;
  try {
    const results = (await scripting.executeScript({
      target: { tabId },
      func: inTabFetch,
      args: [url, MAX_HTML_BYTES],
    })) as Array<{ result?: { b64?: string; html?: string; url: string } | null }>;
    const result = results[0]?.result;
    if (!result) return undefined;
    if (result.html !== undefined) return { finalUrl: result.url, html: result.html };
    if (!result.b64) return undefined;
    const binary = atob(result.b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return isPdfBytes(bytes) ? { finalUrl: result.url, pdf: { bytes, url: result.url } } : undefined;
  } catch {
    return undefined;
  }
}

// Runs in the tab (serialized): must not reference anything outside itself.
async function inTabFetch(url: string, maxHtml: number): Promise<{ b64?: string; html?: string; url: string } | null> {
  try {
    const res = await fetch(url, { credentials: "include" });
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    const finalUrl = res.url || url;
    const head = String.fromCharCode(...bytes.subarray(0, 1024));
    if (!head.includes("%PDF-")) {
      const type = (res.headers.get("content-type") ?? "").toLowerCase();
      return type.includes("html") && bytes.length <= maxHtml ? { html: new TextDecoder().decode(bytes), url: finalUrl } : null;
    }
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return { b64: btoa(binary), url: finalUrl };
  } catch {
    return null;
  }
}
