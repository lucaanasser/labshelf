/**
 * Resolves open-access PDFs and learns identifiers from OpenAlex. The singleton
 * lookup `/works/doi:<doi>` is free (0 credits per the apis-A research, §2.1);
 * the `search=`/`title.search:` forms cost 10 credits and are deliberately not
 * used here. OpenAlex returns every known location (publisher, PMC, arXiv,
 * repository), so this resolver both emits direct `pdf_url` candidates and feeds
 * ctx.pmcid / ctx.arxivId to the PMC and arXiv pipelines.
 *
 * OpenAlex sometimes attaches a wrong location to a correct DOI (the research
 * saw ResNet's "best" location point at an unrelated thesis), so repository and
 * landing candidates are withheld when a supplied title fails the sameWork
 * guard; publisher copies and learned ids are still used.
 * @depends capture/resolvers/types, capture/titleMatch
 * @dependents capture/resolvers/resolverChain
 */
import type { PdfResolver, ResolveContext } from "./types";
import { sameWork } from "../titleMatch";

interface OpenAlexLocation {
  pdf_url?: string | null;
  landing_page_url?: string | null;
  is_oa?: boolean | null;
  version?: string | null;
  source?: { display_name?: string | null; type?: string | null } | null;
}

interface OpenAlexWork {
  title?: string | null;
  publication_year?: number | null;
  ids?: { pmid?: string | null; pmcid?: string | null; mag?: string | null } | null;
  open_access?: { oa_url?: string | null } | null;
  best_oa_location?: OpenAlexLocation | null;
  locations?: OpenAlexLocation[] | null;
}

// Root select fields only; OpenAlex rejects dotted paths like best_oa_location.pdf_url (§2.1).
const SELECT = "id,doi,title,publication_year,ids,open_access,best_oa_location,locations";
const TIMEOUT_MS = 8000;
// Both old-style (hep-th/9711200) and new-style (1512.03385) arXiv ids on abs/pdf URLs.
const ARXIV_URL_RE =
  /arxiv\.org\/(?:abs|pdf)\/((?:[a-z-]+(?:\.[A-Za-z-]+)?\/\d{7})|(?:\d{4}\.\d{4,5}))(?:v\d+)?/i;
const PMC_URL_RE = /(?:ncbi\.nlm\.nih\.gov\/pmc\/articles\/|pmc\.ncbi\.nlm\.nih\.gov\/articles\/|europepmc\.org\/(?:pmc\/)?articles\/)(?:PMC)?(\d+)/i;

export const openalexResolver: PdfResolver = {
  name: "openalex",
  async resolve(ctx: ResolveContext): Promise<string[]> {
    if (!ctx.doi) return [];
    const url =
      `https://api.openalex.org/works/doi:${encodeURIComponent(ctx.doi)}` +
      `?select=${SELECT}&mailto=${encodeURIComponent(ctx.contactEmail)}`;
    const work = await getJson<OpenAlexWork>(url, TIMEOUT_MS);
    if (!work) return [];

    const locations = [work.best_oa_location, ...(work.locations ?? [])].filter(
      (l): l is OpenAlexLocation => Boolean(l),
    );

    learnIdentifiers(ctx, work, locations);

    // A correct DOI should return its own title; a mismatch means the location
    // set is suspect, so off-publisher (repository) copies are not trusted.
    const trustOffPublisher =
      !ctx.title ||
      !work.title ||
      sameWork(
        { title: work.title, ...(work.publication_year ? { year: work.publication_year } : {}) },
        { title: ctx.title, ...(ctx.year !== undefined ? { year: ctx.year } : {}), ...(ctx.authors ? { authors: ctx.authors } : {}) },
      );
    if (!trustOffPublisher) {
      logEvent("warn", "openalex: title mismatch, trusting publisher copies only", {
        doi: ctx.doi,
        openalexTitle: work.title ?? null,
        expected: ctx.title ?? null,
      });
    }

    const direct: Array<{ url: string; rank: number }> = [];
    const landings: string[] = [];
    if (ctx.arxivId) direct.push({ url: `https://arxiv.org/pdf/${ctx.arxivId}`, rank: 0 });

    for (const loc of locations) {
      const repository = (loc.source?.type ?? "").toLowerCase() === "repository";
      if (repository && !trustOffPublisher) continue;
      const pdf = loc.pdf_url ?? undefined;
      if (pdf && !isPmcUrl(pdf) && !ARXIV_URL_RE.test(pdf)) {
        direct.push({ url: pdf, rank: repository ? 60 : 40 });
      }
      const landing = loc.landing_page_url ?? undefined;
      if (loc.is_oa && !pdf && landing && !isPmcUrl(landing) && !ARXIV_URL_RE.test(landing)) {
        landings.push(landing);
      }
    }
    const oaUrl = work.open_access?.oa_url ?? undefined;
    if (oaUrl && !isPmcUrl(oaUrl) && !ARXIV_URL_RE.test(oaUrl)) direct.push({ url: oaUrl, rank: 45 });

    direct.sort((a, b) => a.rank - b.rank);
    return dedupe([...direct.map((d) => d.url), ...landings]);
  },
};

function learnIdentifiers(ctx: ResolveContext, work: OpenAlexWork, locations: OpenAlexLocation[]): void {
  if (!ctx.pmcid) {
    const fromIds = work.ids?.pmcid ?? undefined;
    const direct = fromIds ? /PMC?(\d+)/i.exec(fromIds)?.[1] : undefined;
    const fromUrl = locations
      .map((l) => matchFirst(PMC_URL_RE, l.landing_page_url, l.pdf_url))
      .find((v): v is string => Boolean(v));
    const digits = direct ?? fromUrl;
    if (digits) ctx.pmcid = `PMC${digits}`;
  }
  if (!ctx.arxivId) {
    const id = locations
      .map((l) => matchFirst(ARXIV_URL_RE, l.landing_page_url, l.pdf_url))
      .find((v): v is string => Boolean(v));
    if (id) ctx.arxivId = id;
  }
}

function matchFirst(re: RegExp, ...values: Array<string | null | undefined>): string | undefined {
  for (const value of values) {
    if (!value) continue;
    const m = re.exec(value);
    if (m?.[1]) return m[1];
  }
  return undefined;
}

function isPmcUrl(url: string): boolean {
  return PMC_URL_RE.test(url);
}

function dedupe(urls: string[]): string[] {
  return [...new Set(urls)];
}

async function getJson<T>(url: string, timeoutMs: number): Promise<T | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
    if (!res.ok) return undefined;
    return (await res.json()) as T;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

// Logging depends on the WebExtension runtime (BrowserLogger -> webextension-polyfill),
// which is absent in unit tests; a guarded dynamic import keeps the resolver testable.
function logEvent(level: "info" | "warn", message: string, context: Record<string, unknown>): void {
  void (async () => {
    try {
      const mod = await import("../../platform/logger");
      const logger = new mod.BrowserLogger("capture");
      await (level === "warn" ? logger.warn(message, context) : logger.info(message, context));
    } catch {
      // No runtime logger available.
    }
  })();
}
