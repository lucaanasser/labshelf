/**
 * Thin clients for the bibliographic registries LabShelf resolves against.
 * Each function maps one registry's payload onto ResolvedMetadata and returns
 * undefined on any failure, so the orchestrator can simply try the next source.
 *
 * @depends io/pdf/types.ts
 * @dependents io/pdf/resolver.ts
 */
import type { ResolvedMetadata } from "./types.js";

const USER_AGENT = "LabShelf/0.1 (research paper manager; mailto:contact@labshelf.dev)";
const REQUEST_TIMEOUT_MS = 12_000;

/** A registry record plus the kind of work it describes. */
export interface RegistryRecord extends ResolvedMetadata {
  // CrossRef mints separate DOIs for a paper's abstract, figures and tables.
  // Those records carry the wrong title, so callers must be able to skip them.
  isComponent?: boolean;
}

/**
 * Looks up a DOI in CrossRef.
 * @usedBy io/pdf/resolver.ts
 * @returns The work's metadata, or undefined when the DOI is unknown.
 */
export async function crossRefByDoi(doi: string): Promise<RegistryRecord | undefined> {
  const payload = await fetchJson<{ message?: CrossRefWork }>(
    `https://api.crossref.org/works/${encodeURIComponent(doi)}`,
  );
  return payload?.message ? mapCrossRefWork(payload.message) : undefined;
}

/**
 * Runs CrossRef's fuzzy bibliographic search over raw front-matter text.
 * This is the workhorse for PDFs that state no identifier at all.
 * @usedBy io/pdf/resolver.ts
 * @returns Up to `rows` candidate works, best match first.
 */
export async function crossRefSearch(query: string, rows = 3): Promise<RegistryRecord[]> {
  const payload = await fetchJson<{ message?: { items?: CrossRefWork[] } }>(
    `https://api.crossref.org/works?rows=${rows}&query.bibliographic=${encodeURIComponent(query)}`,
  );
  return (payload?.message?.items ?? []).map(mapCrossRefWork);
}

/**
 * Looks up an arXiv preprint by its identifier.
 * @usedBy io/pdf/resolver.ts
 * @returns Preprint metadata, or undefined when the id is unknown.
 */
export async function arxivById(arxivId: string): Promise<RegistryRecord | undefined> {
  const xml = await fetchText(
    `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(arxivId)}`,
  );
  const entry = xml?.match(/<entry>([\s\S]*?)<\/entry>/)?.[1];
  if (!entry || /<title>\s*Error/i.test(entry)) {
    return undefined;
  }

  // A preprint has no DOI until it is published; `<id>` is its abstract page.
  return {
    title: xmlText(matchTag(entry, "title")),
    authors: [...entry.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>\s*<\/author>/g)]
      .map((match) => xmlText(match[1] ?? ""))
      .filter((name): name is string => Boolean(name)),
    year: yearOf(matchTag(entry, "published") ?? matchTag(entry, "updated")),
    journal: xmlText(matchTag(entry, "arxiv:journal_ref")) ?? "arXiv preprint",
    doi: xmlText(matchTag(entry, "arxiv:doi")),
    url: xmlText(matchTag(entry, "id")),
    summary: xmlText(matchTag(entry, "summary")),
  };
}

/**
 * Looks up a PubMed record by PMID via the E-utilities summary endpoint.
 * @usedBy io/pdf/resolver.ts
 * @returns Article metadata, or undefined when the PMID is unknown.
 */
export async function pubMedByPmid(pmid: string): Promise<RegistryRecord | undefined> {
  const payload = await fetchJson<{ result?: Record<string, PubMedSummary> }>(
    `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&id=${encodeURIComponent(pmid)}`,
  );
  const record = payload?.result?.[pmid];
  if (!record?.title) {
    return undefined;
  }

  const doi = record.articleids?.find((id) => id.idtype === "doi")?.value;
  return {
    title: stripHtml(record.title),
    authors: (record.authors ?? []).map((author) => author.name).filter(Boolean),
    year: yearOf(record.pubdate),
    journal: record.fulljournalname ?? record.source,
    volume: record.volume,
    issue: record.issue,
    pages: record.pages,
    issn: record.issn,
    doi,
    url: doi ? `https://doi.org/${doi}` : `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
  };
}

/**
 * Resolves a PMC identifier to its PMID so the PubMed record can be fetched.
 * @usedBy io/pdf/resolver.ts
 * @returns The matching PMID, or undefined.
 */
export async function pmidFromPmcid(pmcid: string): Promise<string | undefined> {
  const payload = await fetchJson<{ records?: Array<{ pmid?: string }> }>(
    `https://www.ncbi.nlm.nih.gov/pmc/utils/idconv/v1.0/?format=json&ids=${encodeURIComponent(pmcid)}`,
  );
  return payload?.records?.[0]?.pmid;
}

/**
 * Searches OpenAlex, which indexes far more venues than CrossRef and tolerates
 * noisy titles well.
 * @usedBy io/pdf/resolver.ts
 * @returns Candidate works, best match first.
 */
export async function openAlexSearch(query: string, rows = 3): Promise<RegistryRecord[]> {
  const payload = await fetchJson<{ results?: OpenAlexWork[] }>(
    `https://api.openalex.org/works?per-page=${rows}&search=${encodeURIComponent(query)}`,
  );
  return (payload?.results ?? []).map(mapOpenAlexWork);
}

/**
 * Looks up a DOI in DataCite, which registers datasets, theses and preprints
 * that CrossRef does not carry.
 * @usedBy io/pdf/resolver.ts
 * @returns The record's metadata, or undefined.
 */
export async function dataCiteByDoi(doi: string): Promise<RegistryRecord | undefined> {
  const payload = await fetchJson<{ data?: { attributes?: DataCiteAttributes } }>(
    `https://api.datacite.org/dois/${encodeURIComponent(doi)}`,
  );
  const attributes = payload?.data?.attributes;
  if (!attributes?.titles?.[0]?.title) {
    return undefined;
  }

  return {
    title: attributes.titles[0].title,
    authors: (attributes.creators ?? [])
      .map((creator) => creator.name ?? [creator.givenName, creator.familyName].filter(Boolean).join(" "))
      .filter((name): name is string => Boolean(name)),
    year: attributes.publicationYear,
    publisher: attributes.publisher,
    doi: attributes.doi,
    url: attributes.url,
    summary: attributes.descriptions?.[0]?.description,
  };
}

/**
 * Looks up a book by ISBN through OpenLibrary.
 * @usedBy io/pdf/resolver.ts
 * @returns Book metadata, or undefined.
 */
export async function openLibraryByIsbn(isbn: string): Promise<RegistryRecord | undefined> {
  const key = `ISBN:${isbn}`;
  const payload = await fetchJson<Record<string, OpenLibraryBook>>(
    `https://openlibrary.org/api/books?format=json&jscmd=data&bibkeys=${encodeURIComponent(key)}`,
  );
  const book = payload?.[key];
  if (!book?.title) {
    return undefined;
  }

  return {
    title: book.subtitle ? `${book.title}: ${book.subtitle}` : book.title,
    authors: (book.authors ?? []).map((author) => author.name).filter(Boolean),
    year: yearOf(book.publish_date),
    publisher: book.publishers?.[0]?.name,
    pages: book.number_of_pages ? String(book.number_of_pages) : undefined,
    url: book.url,
  };
}

/**
 * Matches a title against Semantic Scholar's dedicated title-match endpoint.
 * Unlike the generic `/paper/search`, this one is built for "is there a paper
 * with roughly this title", so it either returns the single best match or a 404
 * — which `fetchJson` already turns into undefined.
 * @usedBy io/pdf/resolver.ts
 * @returns The matched paper, or undefined when nothing matches.
 */
export async function semanticScholarByTitle(title: string): Promise<RegistryRecord | undefined> {
  const payload = await fetchJson<{ data?: SemanticScholarPaper[] }>(
    `https://api.semanticscholar.org/graph/v1/paper/search/match?query=${encodeURIComponent(title)}&fields=${SEMANTIC_SCHOLAR_FIELDS}`,
  );
  const paper = payload?.data?.[0];
  return paper?.title ? mapSemanticScholarPaper(paper) : undefined;
}

/**
 * Looks up a DOI in Semantic Scholar. Worth querying even after CrossRef
 * succeeds, because Semantic Scholar holds abstracts for a large share of the
 * works CrossRef indexes without one.
 * @usedBy io/pdf/resolver.ts
 * @returns The paper's metadata, or undefined when the DOI is unknown.
 */
export async function semanticScholarByDoi(doi: string): Promise<RegistryRecord | undefined> {
  const paper = await fetchJson<SemanticScholarPaper>(
    `https://api.semanticscholar.org/graph/v1/paper/DOI:${encodeDoiPathSegment(doi)}?fields=${SEMANTIC_SCHOLAR_FIELDS}`,
  );
  return paper?.title ? mapSemanticScholarPaper(paper) : undefined;
}

/**
 * Searches Europe PMC, which covers preprint servers and European journals that
 * PubMed omits, and accepts free-text queries.
 * @usedBy io/pdf/resolver.ts
 * @returns Up to `rows` candidate articles, best match first.
 */
export async function europePmcSearch(query: string, rows = 3): Promise<RegistryRecord[]> {
  const payload = await fetchJson<{ resultList?: { result?: EuropePmcResult[] } }>(
    `https://www.ebi.ac.uk/europepmc/webservices/rest/search?format=json&pageSize=${rows}&query=${encodeURIComponent(query)}`,
  );
  return (payload?.resultList?.result ?? []).map(mapEuropePmcResult);
}

/**
 * Searches DBLP. Computer-science work is overwhelmingly published at
 * conferences, which CrossRef indexes patchily, so DBLP is the only reliable
 * source for a large part of the field.
 * @usedBy io/pdf/resolver.ts
 * @returns Up to `rows` candidate publications, best match first.
 */
export async function dblpSearch(query: string, rows = 3): Promise<RegistryRecord[]> {
  const payload = await fetchJson<{ result?: { hits?: { hit?: DblpHit[] } } }>(
    `https://dblp.org/search/publ/api?format=json&h=${rows}&q=${encodeURIComponent(query)}`,
  );
  // DBLP drops `hit` entirely when the query matches nothing.
  return (payload?.result?.hits?.hit ?? [])
    .map((hit) => hit.info)
    .filter((info): info is DblpInfo => Boolean(info?.title))
    .map(mapDblpInfo);
}

/**
 * Looks up a book by ISBN through Google Books, which carries descriptions and
 * page counts for many editions OpenLibrary has only a stub for.
 * @usedBy io/pdf/resolver.ts
 * @returns Book metadata, or undefined.
 */
export async function googleBooksByIsbn(isbn: string): Promise<RegistryRecord | undefined> {
  const payload = await fetchJson<{ items?: Array<{ volumeInfo?: GoogleBooksVolumeInfo }> }>(
    `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(`isbn:${isbn}`)}`,
  );
  const volume = payload?.items?.[0]?.volumeInfo;
  if (!volume?.title) {
    return undefined;
  }

  return {
    title: volume.subtitle ? `${volume.title}: ${volume.subtitle}` : volume.title,
    authors: (volume.authors ?? []).filter((name): name is string => Boolean(name)),
    year: yearOf(volume.publishedDate),
    publisher: trimmed(volume.publisher),
    pages: volume.pageCount ? String(volume.pageCount) : undefined,
    url: trimmed(volume.infoLink),
    language: trimmed(volume.language),
    summary: volume.description ? stripHtml(volume.description) : undefined,
  };
}

// ─── payload mappers ─────────────────────────────────────────────────────────

interface CrossRefWork {
  type?: string;
  title?: string[];
  author?: Array<{ given?: string; family?: string; name?: string }>;
  issued?: { "date-parts"?: number[][] };
  "container-title"?: string[];
  "short-container-title"?: string[];
  publisher?: string;
  volume?: string;
  issue?: string;
  page?: string;
  DOI?: string;
  URL?: string;
  ISSN?: string[];
  language?: string;
  abstract?: string;
}

function mapCrossRefWork(work: CrossRefWork): RegistryRecord {
  return {
    title: firstNonEmpty(work.title),
    authors: (work.author ?? [])
      .map((author) => author.name ?? [author.given, author.family].filter(Boolean).join(" ").trim())
      .filter((name): name is string => Boolean(name)),
    year: work.issued?.["date-parts"]?.[0]?.[0],
    journal: firstNonEmpty(work["container-title"]) ?? firstNonEmpty(work["short-container-title"]),
    publisher: trimmed(work.publisher),
    volume: trimmed(work.volume),
    issue: trimmed(work.issue),
    pages: trimmed(work.page),
    doi: trimmed(work.DOI),
    url: trimmed(work.URL),
    issn: trimmed(work.ISSN?.[0]),
    language: trimmed(work.language),
    // CrossRef abstracts carry JATS XML markup.
    summary: work.abstract ? stripHtml(work.abstract) : undefined,
    isComponent: work.type === "component",
  };
}

interface OpenAlexWork {
  title?: string;
  display_name?: string;
  doi?: string;
  publication_year?: number;
  language?: string;
  authorships?: Array<{ author?: { display_name?: string } }>;
  primary_location?: {
    source?: { display_name?: string; issn_l?: string; host_organization_name?: string };
    landing_page_url?: string;
  };
  biblio?: { volume?: string; issue?: string; first_page?: string; last_page?: string };
}

function mapOpenAlexWork(work: OpenAlexWork): RegistryRecord {
  const biblio = work.biblio;
  const pages =
    biblio?.first_page && biblio.last_page && biblio.first_page !== biblio.last_page
      ? `${biblio.first_page}-${biblio.last_page}`
      : biblio?.first_page;

  return {
    title: work.title ?? work.display_name,
    authors: (work.authorships ?? [])
      .map((authorship) => authorship.author?.display_name)
      .filter((name): name is string => Boolean(name)),
    year: work.publication_year,
    journal: work.primary_location?.source?.display_name,
    publisher: work.primary_location?.source?.host_organization_name,
    volume: trimmed(biblio?.volume),
    issue: trimmed(biblio?.issue),
    pages: trimmed(pages),
    // OpenAlex returns the DOI as a resolver URL.
    doi: work.doi?.replace(/^https?:\/\/(dx\.)?doi\.org\//i, ""),
    url: work.primary_location?.landing_page_url,
    issn: work.primary_location?.source?.issn_l,
    language: trimmed(work.language),
  };
}

interface PubMedSummary {
  title?: string;
  authors?: Array<{ name: string }>;
  pubdate?: string;
  fulljournalname?: string;
  source?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  issn?: string;
  articleids?: Array<{ idtype?: string; value?: string }>;
}

interface DataCiteAttributes {
  doi?: string;
  titles?: Array<{ title?: string }>;
  creators?: Array<{ name?: string; givenName?: string; familyName?: string }>;
  publisher?: string;
  publicationYear?: number;
  url?: string;
  descriptions?: Array<{ description?: string }>;
}

interface OpenLibraryBook {
  title?: string;
  subtitle?: string;
  authors?: Array<{ name: string }>;
  publishers?: Array<{ name: string }>;
  publish_date?: string;
  number_of_pages?: number;
  url?: string;
}

// Requested explicitly, because the graph API returns only `paperId` otherwise.
const SEMANTIC_SCHOLAR_FIELDS =
  "title,abstract,year,authors,externalIds,venue,publicationVenue,openAccessPdf,journal";

interface SemanticScholarPaper {
  title?: string;
  abstract?: string | null;
  year?: number | null;
  venue?: string;
  authors?: Array<{ name?: string }>;
  externalIds?: { DOI?: string | null } | null;
  publicationVenue?: { name?: string } | null;
  openAccessPdf?: { url?: string } | null;
  journal?: { name?: string; volume?: string; pages?: string } | null;
}

function mapSemanticScholarPaper(paper: SemanticScholarPaper): RegistryRecord {
  return {
    title: trimmed(paper.title),
    authors: (paper.authors ?? [])
      .map((author) => trimmed(author.name))
      .filter((name): name is string => Boolean(name)),
    year: paper.year ?? undefined,
    journal:
      trimmed(paper.venue) ?? trimmed(paper.journal?.name) ?? trimmed(paper.publicationVenue?.name),
    volume: trimmed(paper.journal?.volume),
    pages: trimmed(paper.journal?.pages),
    doi: trimmed(paper.externalIds?.DOI ?? undefined),
    // Present but empty whenever no open-access copy is known.
    url: trimmed(paper.openAccessPdf?.url),
    summary: paper.abstract ? stripHtml(paper.abstract) : undefined,
  };
}

interface EuropePmcResult {
  id?: string;
  source?: string;
  title?: string;
  authorString?: string;
  pubYear?: string;
  journalTitle?: string;
  journalVolume?: string;
  issue?: string;
  pageInfo?: string;
  doi?: string;
  journalIssn?: string;
}

function mapEuropePmcResult(result: EuropePmcResult): RegistryRecord {
  // Europe PMC's default `lite` result set carries no abstract, so summaries
  // have to come from another source.
  return {
    title: trimmed(result.title),
    // `authorString` is a display sentence: "Doe J, Roe R." — the final stop is
    // punctuation, not part of the last author's initials.
    authors: (trimmed(result.authorString)?.replace(/\.$/, "") ?? "")
      .split(", ")
      .map((name) => name.trim())
      .filter((name) => name.length > 0),
    year: yearOf(result.pubYear),
    journal: trimmed(result.journalTitle),
    volume: trimmed(result.journalVolume),
    issue: trimmed(result.issue),
    pages: trimmed(result.pageInfo),
    doi: trimmed(result.doi),
    issn: trimmed(result.journalIssn),
    url:
      result.source && result.id
        ? `https://europepmc.org/article/${encodeURIComponent(result.source)}/${encodeURIComponent(result.id)}`
        : undefined,
  };
}

interface DblpAuthor {
  text?: string;
}

interface DblpInfo {
  title?: string;
  // DBLP collapses single-element lists into the element itself, so any of
  // these repeatable fields arrives as either one value or an array.
  authors?: { author?: DblpAuthor | DblpAuthor[] };
  year?: string;
  venue?: string | string[];
  volume?: string;
  pages?: string;
  doi?: string;
  ee?: string | string[];
  url?: string;
}

interface DblpHit {
  info?: DblpInfo;
}

function mapDblpInfo(info: DblpInfo): RegistryRecord {
  return {
    title: trimmed(info.title),
    authors: asArray(info.authors?.author)
      .map((author) => trimmed(author.text))
      .filter((name): name is string => Boolean(name)),
    year: yearOf(info.year),
    journal: firstNonEmpty(asArray(info.venue)),
    volume: trimmed(info.volume),
    pages: trimmed(info.pages),
    doi: trimmed(info.doi),
    url: firstNonEmpty(asArray(info.ee)) ?? trimmed(info.url),
  };
}

interface GoogleBooksVolumeInfo {
  title?: string;
  subtitle?: string;
  authors?: string[];
  publishedDate?: string;
  publisher?: string;
  pageCount?: number;
  description?: string;
  language?: string;
  infoLink?: string;
}

// ─── transport ───────────────────────────────────────────────────────────────

async function fetchJson<T>(url: string): Promise<T | undefined> {
  const body = await fetchText(url);
  if (!body) {
    return undefined;
  }
  try {
    return JSON.parse(body) as T;
  } catch {
    return undefined;
  }
}

async function fetchText(url: string): Promise<string | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      signal: controller.signal,
    });
    return response.ok ? await response.text() : undefined;
  } catch {
    // Offline, rate-limited or timed out — the caller falls through to the
    // next source rather than failing the import.
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

function firstNonEmpty(values: string[] | undefined): string | undefined {
  return values?.map((value) => value.trim()).find((value) => value.length > 0);
}

function trimmed(value: string | undefined): string | undefined {
  return value?.trim() || undefined;
}

/** Normalizes an API field that is one value when singular and a list when not. */
function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

/**
 * Percent-encodes a DOI for use inside a URL path. The slash is restored,
 * because Semantic Scholar routes on the literal `DOI:10.x/y` segment and
 * answers a `%2F` in its place with a rate-limit error instead of the record.
 */
function encodeDoiPathSegment(doi: string): string {
  return encodeURIComponent(doi).replace(/%2F/gi, "/");
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function matchTag(content: string, tagName: string): string | undefined {
  return content.match(new RegExp(`<${tagName}>([\\s\\S]*?)</${tagName}>`, "i"))?.[1];
}

function xmlText(value: string | undefined): string | undefined {
  return value?.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() || undefined;
}

function yearOf(value: string | undefined): number | undefined {
  const match = value?.match(/(?:19|20)\d{2}/);
  return match ? Number(match[0]) : undefined;
}
