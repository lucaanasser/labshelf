/**
 * Resolves a paper against online bibliographic registries.
 *
 * Identifiers recovered from a PDF are candidates, not facts: OCR misreads
 * digits, and a DOI scraped from the text may belong to a cited work. So every
 * candidate is confirmed against a registry, and search hits are checked for
 * agreement with what the PDF itself says before being accepted.
 *
 * @depends io/pdf/types.ts, io/pdf/identifiers.ts, io/pdf/registries.ts
 * @dependents io/pdf/parser.ts, capture/captureService (browser)
 */
import type { DetectedIdentifier, ResolvedMetadata } from "./types.js";
import { doiVariants } from "./identifiers.js";
import {
  arxivById,
  crossRefByDoi,
  crossRefSearch,
  dataCiteByDoi,
  dblpSearch,
  europePmcSearch,
  googleBooksByIsbn,
  openAlexSearch,
  openLibraryByIsbn,
  pmidFromPmcid,
  pubMedByPmid,
  semanticScholarByDoi,
  semanticScholarByTitle,
  type RegistryRecord,
} from "./registries.js";
import { completeness, SOURCE_TRUST, type MetadataSource } from "./merge.js";

// A search hit is accepted only when this much of its title also appears in the
// text we searched with, which keeps a plausible-but-wrong paper out.
const TITLE_MATCH_THRESHOLD = 0.75;

/**
 * Confirms one identifier against the registry that issued it.
 * @usedBy io/pdf/parser.ts, browser capture flow
 * @returns The registry record, or undefined when nothing resolves.
 */
export async function resolveOnlineMetadata(
  identifier: DetectedIdentifier,
): Promise<ResolvedMetadata | undefined> {
  switch (identifier.type) {
    case "doi": {
      // Publishers mint component DOIs for abstracts and figures; those records
      // exist but describe a fragment, so the parent DOI is tried as well.
      for (const variant of doiVariants(identifier.value)) {
        const record = await crossRefByDoi(variant);
        if (record?.title && !record.isComponent) {
          return strip(record);
        }
      }
      for (const variant of doiVariants(identifier.value)) {
        const record = await dataCiteByDoi(variant);
        if (record?.title) {
          return strip(record);
        }
      }
      return undefined;
    }
    case "arxiv":
      return strip(await arxivById(identifier.value));
    case "pmid":
      return strip(await pubMedByPmid(identifier.value));
    case "pmcid": {
      const pmid = await pmidFromPmcid(identifier.value);
      return pmid ? strip(await pubMedByPmid(pmid)) : undefined;
    }
    case "isbn": {
      const book = await openLibraryByIsbn(identifier.value);
      return strip(book?.title ? book : await googleBooksByIsbn(identifier.value));
    }
    default:
      return undefined;
  }
}

/**
 * Tries each detected identifier in turn until one resolves to a real record.
 * @usedBy io/pdf/parser.ts
 * @returns The first confirmed record and the identifier that produced it.
 */
export async function resolveFirstIdentifier(
  identifiers: DetectedIdentifier[],
): Promise<{ metadata: ResolvedMetadata; identifier: DetectedIdentifier } | undefined> {
  for (const identifier of identifiers) {
    const metadata = await resolveOnlineMetadata(identifier).catch(() => undefined);
    if (metadata?.title) {
      return { metadata, identifier };
    }
  }
  return undefined;
}

/**
 * Tries a series of differently-shaped queries until one is recognised.
 *
 * A registry may miss a full page of front matter yet match the bare title, or
 * the other way round when the title is generic and the authors disambiguate
 * it. Trying several shapes costs one request each and rescues papers a single
 * query shape would lose.
 * @usedBy io/pdf/parser.ts
 * @returns The first confident match and the query that found it.
 */
export async function searchOnlineByQueries(
  queries: Array<string | undefined>,
): Promise<{ metadata: ResolvedMetadata; query: string } | undefined> {
  const tried = new Set<string>();
  for (const query of queries) {
    const candidate = query?.trim();
    if (!candidate || candidate.length < 12) {
      continue;
    }
    const key = normalizeForMatch(candidate).slice(0, 120);
    if (tried.has(key)) {
      continue;
    }
    tried.add(key);

    const metadata = await searchOnlineByText(candidate).catch(() => undefined);
    if (metadata) {
      return { metadata, query: candidate };
    }
  }
  return undefined;
}

/**
 * Finds a paper from noisy front-matter text — the fallback for PDFs that
 * state no identifier, and the only route for text recovered by OCR.
 * @usedBy io/pdf/parser.ts
 * @returns A confidently matching record, or undefined.
 */
export async function searchOnlineByText(query: string): Promise<ResolvedMetadata | undefined> {
  const normalized = normalizeForMatch(query);
  if (normalized.length < 20) {
    return undefined;
  }

  // Every index has blind spots: CrossRef misses many conference papers, DBLP
  // covers exactly those, Europe PMC covers biomedical venues, and Semantic
  // Scholar's match endpoint is the most tolerant of OCR noise. Asking them all
  // at once costs one round trip and rescues papers any single index would lose.
  const searchTerm = normalized.slice(0, 600);
  const groups = await Promise.all(searchAllRegistries(searchTerm));

  // Word overlap alone accepts far too much when the query is a page of front
  // matter: the three words of "Depth First Search" all occur somewhere in the
  // abstract of a paper about graph search. A title the PDF really prints sits
  // in one place, and near the top, so each record is located in the query and
  // the earliest one wins. Ties — every record sits at 0 when the query is just
  // a title — go to the record whose title occurs verbatim ("Attention Is All
  // You Need" against "Is Attention All You Need?"), then to the most complete.
  const queryWords = normalized.split(" ").filter((word) => word.length > 2);
  let best: { record: RegistryRecord; position: number; verbatim: boolean; score: number } | undefined;
  for (const record of groups.flat()) {
    if (!record.title || record.isComponent) {
      continue;
    }
    if (titleOverlap(record.title, query) < TITLE_MATCH_THRESHOLD) {
      continue;
    }
    const position = titlePosition(record.title, queryWords);
    if (position === undefined) {
      continue;
    }
    const verbatim = ` ${normalized} `.includes(` ${normalizeForMatch(record.title)} `);
    const score = completeness(record);
    const better =
      !best ||
      position < best.position ||
      (position === best.position && verbatim && !best.verbatim) ||
      (position === best.position && verbatim === best.verbatim && score > best.score);
    if (better) {
      best = { record, position, verbatim, score };
    }
  }
  return best ? strip(best.record) : undefined;
}

// A title shorter than this proves nothing when found inside a page of text.
const MIN_TITLE_WORDS_IN_PAGE = 4;

// Finds where in the query a title is printed: the first run of words, about as
// long as the title, holding most of its words. Returns 0 when the query is
// itself title-sized, and undefined when the title's words are only scattered
// across a page — or when the title is too short for that to mean anything.
function titlePosition(title: string, queryWords: string[]): number | undefined {
  const titleWords = significantWords(title);
  if (queryWords.length <= titleWords.size * 3) {
    return 0;
  }
  if (titleWords.size < MIN_TITLE_WORDS_IN_PAGE) {
    return undefined;
  }

  const span = titleWords.size + Math.max(2, Math.floor(titleWords.size / 2));
  const needed = Math.ceil(titleWords.size * TITLE_MATCH_THRESHOLD);
  for (let start = 0; start < queryWords.length; start += 1) {
    if (!titleWords.has(queryWords[start]!)) {
      continue;
    }
    const found = new Set(queryWords.slice(start, start + span).filter((word) => titleWords.has(word)));
    if (found.size >= needed) {
      return start;
    }
  }
  return undefined;
}

// Fans one query out to every registry that supports free-text search.
function searchAllRegistries(query: string, rows = 3): Array<Promise<RegistryRecord[]>> {
  const single = (promise: Promise<RegistryRecord | undefined>): Promise<RegistryRecord[]> =>
    promise.then((record) => (record ? [record] : [])).catch(() => []);

  return [
    crossRefSearch(query, rows).catch((): RegistryRecord[] => []),
    openAlexSearch(query, rows).catch((): RegistryRecord[] => []),
    europePmcSearch(query, rows).catch((): RegistryRecord[] => []),
    dblpSearch(query, rows).catch((): RegistryRecord[] => []),
    single(semanticScholarByTitle(query)),
  ];
}

/**
 * Queries the registries that were not used to confirm the identifier, to fill
 * fields the first one left blank — most often the abstract, which CrossRef
 * omits for a large share of its records.
 * @usedBy io/pdf/parser.ts
 * @returns One source entry per registry that answered.
 */
export async function enrichByDoi(doi: string): Promise<MetadataSource[]> {
  const [semanticScholar, europePmc] = await Promise.all([
    semanticScholarByDoi(doi).catch(() => undefined),
    europePmcSearch(`DOI:"${doi}"`, 1).catch((): RegistryRecord[] => []),
  ]);

  const sources: MetadataSource[] = [];
  if (semanticScholar?.title) {
    sources.push({ name: "semanticscholar", trust: SOURCE_TRUST.enrichment, metadata: strip(semanticScholar) });
  }
  const europePmcRecord = europePmc[0];
  if (europePmcRecord?.title) {
    sources.push({ name: "europepmc", trust: SOURCE_TRUST.enrichment, metadata: strip(europePmcRecord) });
  }
  return sources;
}

/**
 * Looks a paper up by a title already believed to be correct.
 * @usedBy io/pdf/parser.ts, commands/fetchMetadata.ts
 * @returns A confidently matching record, or undefined.
 */
export async function searchOnlineByTitle(title: string): Promise<ResolvedMetadata | undefined> {
  return title.trim().length >= 12 ? searchOnlineByText(title) : undefined;
}

/**
 * Returns every plausible match for a query, best first, for a human to choose
 * between. A short title can match several real works closely — "Attention Is
 * All You Need" and the chapter "Is Attention All You Need?" score alike — so
 * an interactive lookup should offer the options rather than pick one.
 * @usedBy commands/fetchMetadata.ts
 * @returns Deduplicated candidates ordered by how well they match the query.
 */
export async function searchOnlineCandidates(query: string, limit = 8): Promise<ResolvedMetadata[]> {
  const normalized = normalizeForMatch(query);
  if (normalized.length < 6) {
    return [];
  }

  const searchTerm = normalized.slice(0, 600);
  const groups = await Promise.all(searchAllRegistries(searchTerm, limit));

  const byKey = new Map<string, { record: ResolvedMetadata; score: number }>();
  for (const record of groups.flat()) {
    if (!record.title || record.isComponent) {
      continue;
    }
    const key = (record.doi ?? record.title).toLowerCase();
    const score = titleOverlap(record.title, query);
    const existing = byKey.get(key);
    if (!existing || score > existing.score) {
      byKey.set(key, { record: strip(record)!, score });
    }
  }

  return [...byKey.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.record);
}

/**
 * Measures how much of `candidate` appears in `source`, ignoring case,
 * punctuation and word order. Asymmetric on purpose: `source` may be a whole
 * page of front matter, of which the title is only a part.
 * @usedBy io/pdf/resolver.ts, commands/registerCommands.ts
 * @returns Fraction of the candidate's significant words found in the source.
 */
export function titleOverlap(candidate: string, source: string): number {
  const candidateWords = significantWords(candidate);
  if (candidateWords.size === 0) {
    return 0;
  }

  const sourceWords = significantWords(source);
  let shared = 0;
  for (const word of candidateWords) {
    if (sourceWords.has(word)) {
      shared += 1;
    }
  }
  return shared / candidateWords.size;
}

function significantWords(value: string): Set<string> {
  return new Set(
    normalizeForMatch(value)
      .split(" ")
      .filter((word) => word.length > 2),
  );
}

function normalizeForMatch(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9à-ÿ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Drops the registry-only discriminator so callers see plain metadata.
function strip(record: RegistryRecord | undefined): ResolvedMetadata | undefined {
  if (!record) {
    return undefined;
  }
  const { isComponent: _isComponent, ...metadata } = record;
  return metadata;
}
