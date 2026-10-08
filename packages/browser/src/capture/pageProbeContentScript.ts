/**
 * Page probe injected on demand into a tab via scripting.executeScript. It only
 * collects raw evidence — every <meta> value, PDF links and viewers, DOI links —
 * and leaves interpretation to capture/pageFacts, which runs the same rules
 * over HTML the background fetched itself (Scholar landing pages, publisher
 * interstitials). Keeping the probe dumb keeps both paths identical.
 * @depends none (must not import anything — serialized via Function.toString at inject time)
 * @dependents capture/captureService
 */

/** A link or viewer on the page that may lead to the article PDF. */
export interface RawPdfLink {
  url: string;
  /**
   * embed — a PDF viewer embedded in the page (<embed>/<iframe>/<object>);
   * alternate — <link rel="alternate" type="application/pdf">;
   * labelled — an anchor whose text, title or attributes say "PDF";
   * href — an anchor whose URL looks like a PDF.
   */
  kind: "embed" | "alternate" | "labelled" | "href";
}

/** Everything the probe saw, as plain JSON (it crosses the scripting boundary). */
export interface RawPage {
  pageUrl: string;
  /** document.title, or the PDF viewer's title when the tab is a PDF. */
  documentTitle?: string;
  /** True when the tab is showing a PDF document itself. */
  pageIsPdf?: boolean;
  /** Lower-cased <meta name|property> → every content value, in page order. */
  meta: Record<string, string[]>;
  pdfLinks: RawPdfLink[];
  /** hrefs of doi.org links — publishers print the article's own DOI this way. */
  doiLinks: string[];
}

/**
 * Inspects the page DOM and returns the raw evidence. Serialized via
 * Function.prototype.toString(), so it MUST NOT close over imported symbols
 * and may only use browser globals.
 * @usedBy capture/captureService (passed as func to scripting.executeScript)
 * @returns RawPage
 */
export function probe(): RawPage {
  const meta: Record<string, string[]> = {};
  for (const el of Array.from(document.querySelectorAll<HTMLMetaElement>("meta[name], meta[property]"))) {
    const key = (el.getAttribute("name") ?? el.getAttribute("property") ?? "").trim().toLowerCase();
    const value = (el.content ?? "").trim();
    if (!key || !value) continue;
    (meta[key] ??= []).push(value);
  }

  const pdfLinks: Array<{ url: string; kind: "embed" | "alternate" | "labelled" | "href" }> = [];
  const seen = new Set<string>();
  const add = (raw: string | null | undefined, kind: "embed" | "alternate" | "labelled" | "href"): void => {
    if (!raw || raw.startsWith("javascript:") || raw.startsWith("blob:") || raw.startsWith("data:")) return;
    let url: string;
    try { url = new URL(raw, location.href).href; } catch { return; }
    if (!/^https?:/.test(url) || seen.has(url)) return;
    seen.add(url);
    pdfLinks.push({ url, kind });
  };

  // A PDF viewer embedded in the page is the paper itself.
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(
    'embed[type="application/pdf"], embed[src*=".pdf"], iframe[src*=".pdf"], iframe[src*="/pdf"], object[type="application/pdf"], object[data*=".pdf"]',
  ))) {
    add(el.getAttribute("src") ?? el.getAttribute("data"), "embed");
  }
  for (const el of Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="alternate"][type="application/pdf"]'))) {
    add(el.getAttribute("href"), "alternate");
  }
  const PDF_WORD = /(^|[^a-z])pdf([^a-z]|$)/i;
  for (const a of Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"))) {
    const href = a.getAttribute("href") ?? "";
    const label = `${a.textContent ?? ""} ${a.title} ${a.getAttribute("aria-label") ?? ""} ${a.className} ${a.getAttribute("data-track-action") ?? ""}`;
    if (a.getAttribute("type") === "application/pdf" || (PDF_WORD.test(label) && label.length < 300)) add(href, "labelled");
    else if (/\.pdf(?:[?#]|$)|\/pdf(?:direct|ft)?\/|\/epdf\/|[?&]type=printable/i.test(href)) add(href, "href");
  }

  const doiLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="doi.org/10."]'))
    .map((a) => a.href)
    .slice(0, 20);

  const pageIsPdf = document.contentType === "application/pdf";
  const raw: RawPage = { pageUrl: location.href, meta, pdfLinks: pdfLinks.slice(0, 40), doiLinks };
  if (document.title.trim()) raw.documentTitle = document.title.trim();
  if (pageIsPdf) raw.pageIsPdf = true;
  return raw;
}
