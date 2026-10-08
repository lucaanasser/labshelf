/**
 * Resolves PDFs and learns identifiers from the Semantic Scholar Graph API
 * (no key). The research (apis-A §2.2) found the unauthenticated endpoint
 * throttles hard — about 55% of calls return 429 with no Retry-After — so this
 * resolver makes at most one call per capture, uses an 8 s timeout with no
 * retry, and treats 429/404 as "unknown" (a soft miss, never "no PDF").
 *
 * The valuable part is `externalIds` (ArXiv / PubMedCentral / ACL), which the
 * core metadata mapper drops today; those feed the arXiv, PMC and ACL pipelines.
 * `openAccessPdf.url` is frequently a landing page or the wrong item, so it is
 * only trusted when a supplied title clears the sameWork guard.
 * @depends capture/resolvers/types, capture/titleMatch
 * @dependents capture/resolvers/resolverChain
 */
import type { PdfResolver, ResolveContext } from "./types";
import { sameWork } from "../titleMatch";

interface S2Author {
  name?: string | null;
}

interface S2Paper {
  title?: string | null;
  year?: number | null;
  authors?: S2Author[] | null;
  openAccessPdf?: { url?: string | null; status?: string | null } | null;
  externalIds?: {
    ArXiv?: string | null;
    ACL?: string | null;
    PubMedCentral?: string | null;
    DOI?: string | null;
  } | null;
}

const FIELDS = "title,year,authors,externalIds,openAccessPdf";
const TIMEOUT_MS = 8000;
const ARXIV_URL_RE = /arxiv\.org\/(?:abs|pdf)\//i;
const PMC_URL_RE = /(?:ncbi\.nlm\.nih\.gov\/pmc\/articles\/|pmc\.ncbi\.nlm\.nih\.gov\/articles\/)/i;
// One lookup per capture: each capture owns one ResolveContext.
const queried = new WeakSet<ResolveContext>();

export const semanticScholarResolver: PdfResolver = {
  name: "semantic-scholar",
  async resolve(ctx: ResolveContext): Promise<string[]> {
    const id = paperId(ctx);
    if (!id || queried.has(ctx)) return [];
    queried.add(ctx);

    const url = `https://api.semanticscholar.org/graph/v1/paper/${id}?fields=${FIELDS}`;
    const paper = await fetchPaper(url);
    if (!paper) return [];

    if (ctx.title && paper.title && !matchesExpected(ctx, paper)) {
      logEvent("warn", "semantic-scholar: record title does not match, ignoring", {
        id,
        s2Title: paper.title,
        expected: ctx.title,
      });
      return [];
    }

    const out: string[] = [];
    const ids = paper.externalIds ?? {};

    const arxiv = (ids.ArXiv ?? "").replace(/v\d+$/i, "");
    if (arxiv) {
      if (!ctx.arxivId) ctx.arxivId = arxiv;
      out.push(`https://arxiv.org/pdf/${arxiv}`);
    }

    const acl = ids.ACL ?? "";
    if (acl) out.push(`https://aclanthology.org/${aclId(acl)}.pdf`);

    const pmc = (ids.PubMedCentral ?? "").replace(/^PMC/i, "");
    if (pmc && !ctx.pmcid) ctx.pmcid = `PMC${pmc}`;

    const oa = paper.openAccessPdf?.url ?? "";
    const closed = (paper.openAccessPdf?.status ?? "").toUpperCase() === "CLOSED";
    if (oa && !closed && !ARXIV_URL_RE.test(oa) && !PMC_URL_RE.test(oa)) out.push(oa);

    return [...new Set(out)];
  },
};

function paperId(ctx: ResolveContext): string | undefined {
  if (ctx.doi) return `DOI:${encodeURIComponent(ctx.doi)}`;
  if (ctx.arxivId) return `ARXIV:${ctx.arxivId.replace(/v\d+$/i, "")}`;
  if (ctx.pmid) return `PMID:${ctx.pmid}`;
  return undefined;
}

function matchesExpected(ctx: ResolveContext, paper: S2Paper): boolean {
  return sameWork(
    {
      title: paper.title ?? undefined,
      ...(paper.year ? { year: paper.year } : {}),
      ...(paper.authors ? { authors: paper.authors.map((a) => a.name ?? "").filter(Boolean) } : {}),
    },
    {
      title: ctx.title,
      ...(ctx.year !== undefined ? { year: ctx.year } : {}),
      ...(ctx.authors ? { authors: ctx.authors } : {}),
    },
  );
}

// Old-style ACL ids (N19-1423) are case-sensitive on aclanthology.org and must
// be upper-cased; new-style ids (2020.acl-main.1) stay as given.
function aclId(id: string): string {
  return /^[a-z]\d{2}-\d{4}$/i.test(id) ? id.toUpperCase() : id;
}

async function fetchPaper(url: string): Promise<S2Paper | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
    if (res.status === 429) {
      logEvent("warn", "semantic-scholar: rate limited (429), skipping", { url });
      return undefined;
    }
    if (!res.ok) return undefined;
    return (await res.json()) as S2Paper;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

// Logging depends on the WebExtension runtime, absent in unit tests; a guarded
// dynamic import keeps the resolver testable without it.
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
