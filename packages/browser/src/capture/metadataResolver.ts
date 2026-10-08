/**
 * Settles a paper's bibliographic record from everything capture knows: the
 * registry record behind its identifier (CrossRef / DataCite / arXiv /
 * PubMed), the fields the page states in its citation tags, and — when there
 * is no identifier — a registry search by title, accepted only when year and
 * authors agree with the page. Fields are merged one by one, most trusted
 * source first (core mergeMetadata), so a registry that lacks the issue
 * number does not erase the one the page printed.
 * @depends @labshelf/core (resolveOnlineMetadata, searchOnlineByTitle, enrichByDoi, mergeMetadata), capture/doiDetector
 * @dependents capture/captureService, capture/scholarCapture
 */
import type { DetectedIdentifier, MetadataSource, ResolvedMetadata } from "@labshelf/core";
import { enrichByDoi, mergeMetadata, resolveOnlineMetadata, searchOnlineByTitle, SOURCE_TRUST } from "@labshelf/core";
import { arxivIdFromDoi } from "./doiDetector";
import type { DetectedIds } from "./doiDetector";

/** How much a page's own tags are trusted: below the registry, above a title search. */
export const PAGE_TRUST = { structured: 80, titleOnly: 25 } as const;

/** Where the winning record came from, for the UI and the log. */
export type MetadataOrigin = "registry" | "search" | "page" | "none";

export interface MetadataResult {
  metadata: ResolvedMetadata;
  ids: DetectedIds;
  origin: MetadataOrigin;
}

export interface MetadataInput {
  ids: DetectedIds;
  /** Fields from the page (or Scholar result) and how much to trust them. */
  sources: MetadataSource[];
}

/**
 * Resolves and merges the record.
 * @usedBy capture/captureService, capture/scholarCapture
 */
export async function resolveMetadata(input: MetadataInput): Promise<MetadataResult> {
  const ids: DetectedIds = { ...input.ids };
  const sources = [...input.sources];
  let origin: MetadataOrigin = sources.some((s) => s.metadata?.title) ? "page" : "none";

  const registry = await registryRecord(ids);
  if (registry?.title) {
    sources.push({ name: "registry", trust: SOURCE_TRUST.confirmedIdentifier, metadata: registry });
    origin = "registry";
  } else {
    const best = bestPageRecord(input.sources);
    const found = best?.title ? await searchOnlineByTitle(best.title).catch(() => undefined) : undefined;
    if (found && agrees(found, best!)) {
      sources.push({ name: "search", trust: SOURCE_TRUST.search, metadata: found });
      origin = "search";
    }
  }

  const merged = mergeMetadata(sources).metadata;
  const keywords = sources.sort((a, b) => b.trust - a.trust).find((s) => s.metadata?.keywords?.length)?.metadata?.keywords;
  if (keywords?.length) merged.keywords = keywords;
  if (!ids.doi && merged.doi) ids.doi = merged.doi;
  if (!ids.arxivId) {
    const arxivId = arxivIdFromDoi(merged.doi);
    if (arxivId) ids.arxivId = arxivId;
  }
  return { metadata: merged, ids, origin };
}

/**
 * Fills a missing abstract from the registries that keep one (Semantic
 * Scholar, Europe PMC). Bounded in time: it runs while the user waits.
 * @usedBy capture/captureService
 */
export async function withAbstract(metadata: ResolvedMetadata, timeoutMs = 6000): Promise<ResolvedMetadata> {
  if (metadata.summary || !metadata.doi) return metadata;
  const extra = await Promise.race([
    enrichByDoi(metadata.doi).catch((): MetadataSource[] => []),
    new Promise<MetadataSource[]>((resolve) => setTimeout(() => resolve([]), timeoutMs)),
  ]);
  const summary = extra.find((s) => s.metadata?.summary)?.metadata?.summary;
  return summary ? { ...metadata, summary } : metadata;
}

async function registryRecord(ids: DetectedIds): Promise<ResolvedMetadata | undefined> {
  const tries: DetectedIdentifier[] = [];
  // A journal DOI describes the published version; an arXiv DOI only the preprint.
  if (ids.doi && !arxivIdFromDoi(ids.doi)) tries.push({ type: "doi", value: ids.doi });
  if (ids.arxivId) tries.push({ type: "arxiv", value: ids.arxivId });
  if (ids.pmid) tries.push({ type: "pmid", value: ids.pmid });
  for (const id of tries) {
    const record = await resolveOnlineMetadata(id).catch(() => undefined);
    if (record?.title) return record;
  }
  return undefined;
}

function bestPageRecord(sources: MetadataSource[]): ResolvedMetadata | undefined {
  return [...sources].sort((a, b) => b.trust - a.trust).find((s) => s.metadata?.title)?.metadata;
}

/**
 * A title search hit is accepted only when it does not contradict the page:
 * same year (±1, for online-first vs issue dates) and a shared author surname.
 * @usedBy resolveMetadata, tests
 */
export function agrees(found: ResolvedMetadata, page: ResolvedMetadata): boolean {
  if (found.year && page.year && Math.abs(found.year - page.year) > 1) return false;
  if (found.authors?.length && page.authors?.length) {
    const surnames = new Set(found.authors.map(surname));
    return page.authors.some((a) => surnames.has(surname(a)));
  }
  return true;
}

/** Last word of a name, accent-folded and lower-cased ("Shor…" → "shor"). */
export function surname(name: string): string {
  const words = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z\s-]/g, " ").trim().split(/\s+/);
  return words[words.length - 1] ?? "";
}
