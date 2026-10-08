/**
 * Resolves PDFs and the PMCID from the Europe PMC REST API. The research
 * (apis-A §2.3) found the API reliable but its own PDF endpoints
 * (`?pdf=render`, `ptpmcrender`) Cloudflare-walled, so this resolver reads only
 * identifiers and non-Europe_PMC full-text links; the PMCID is handed to the
 * pmc resolver. Europe PMC also maps the wrong record for some DOIs (XGBoost ->
 * a cognitive-impairment paper), so a result is accepted only when its DOI
 * matches and, when a title is known, it clears the sameWork guard.
 * @depends capture/resolvers/types, capture/titleMatch
 * @dependents capture/resolvers/resolverChain
 */
import type { PdfResolver, ResolveContext } from "./types";
import { sameWork } from "../titleMatch";

interface EpmcFullTextUrl {
  documentStyle?: string | null;
  site?: string | null;
  url?: string | null;
}

interface EpmcResult {
  pmid?: string | null;
  pmcid?: string | null;
  doi?: string | null;
  title?: string | null;
  pubYear?: string | null;
  inPMC?: string | null;
  inEPMC?: string | null;
  fullTextUrlList?: { fullTextUrl?: EpmcFullTextUrl[] } | null;
}

interface EpmcResponse {
  resultList?: { result?: EpmcResult[] } | null;
}

const BASE = "https://www.ebi.ac.uk/europepmc/webservices/rest/search";
const TIMEOUT_MS = 8000;

export const europePmcResolver: PdfResolver = {
  name: "europepmc",
  async resolve(ctx: ResolveContext): Promise<string[]> {
    const query = buildQuery(ctx);
    if (!query) return [];
    const url = `${BASE}?query=${encodeURIComponent(query)}&resultType=core&format=json&pageSize=3`;
    const payload = await getJson<EpmcResponse>(url, TIMEOUT_MS);
    const results = payload?.resultList?.result ?? [];
    const match = results.find((r) => accepts(ctx, r));
    if (!match) {
      if (results.length > 0) {
        logEvent("warn", "europepmc: results rejected by validation", {
          query,
          titles: results.map((r) => r.title ?? null),
        });
      }
      return [];
    }

    const pmcid = (match.pmcid ?? "").toUpperCase();
    if (pmcid && (match.inPMC === "Y" || match.inEPMC === "Y") && !ctx.pmcid) {
      ctx.pmcid = pmcid;
    }

    const out: string[] = [];
    for (const entry of match.fullTextUrlList?.fullTextUrl ?? []) {
      // Europe_PMC-hosted PDFs are Cloudflare-walled; the pmc resolver handles PMC copies.
      if ((entry.site ?? "") === "Europe_PMC") continue;
      if ((entry.documentStyle ?? "").toLowerCase() !== "pdf") continue;
      if (entry.url) out.push(entry.url);
    }
    return [...new Set(out)];
  },
};

function buildQuery(ctx: ResolveContext): string | undefined {
  if (ctx.doi) return `DOI:"${ctx.doi}"`;
  if (ctx.pmcid) return `PMCID:${ctx.pmcid.toUpperCase()}`;
  if (ctx.pmid) return `EXT_ID:${ctx.pmid} AND SRC:MED`;
  return undefined;
}

// A DOI query must come back with the same DOI; a known title must match. Author
// strings are "Surname Initials" here, so they are left out of the comparison.
function accepts(ctx: ResolveContext, r: EpmcResult): boolean {
  if (ctx.doi && (r.doi ?? "").toLowerCase() !== ctx.doi.toLowerCase()) return false;
  if (ctx.title && r.title) {
    const year = r.pubYear ? Number(r.pubYear) : undefined;
    return sameWork(
      { title: r.title, ...(year !== undefined && !Number.isNaN(year) ? { year } : {}) },
      { title: ctx.title, ...(ctx.year !== undefined ? { year: ctx.year } : {}) },
    );
  }
  return true;
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

// Guarded dynamic import: the runtime logger is unavailable in unit tests.
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
