/**
 * Resolves bibliographic metadata for a detected DOI or arXiv identifier via the CrossRef and arXiv HTTP APIs.
 *
 * @depends pdf/types.ts
 * @dependents pdf/parser.ts
 */
import type { DetectedIdentifier, ResolvedMetadata } from "./types.js";

/**
 * Dispatches a metadata lookup to CrossRef (for DOIs) or arXiv (for arXiv IDs) and returns normalized bibliographic data.
 * @usedBy pdf/parser.ts
 * @returns A ResolvedMetadata object with available bibliographic fields, or undefined on failure.
 */
export async function resolveOnlineMetadata(identifier: DetectedIdentifier): Promise<ResolvedMetadata | undefined> {
  if (identifier.type === "doi") {
    return lookupCrossRef(identifier.value);
  }

  if (identifier.type === "arxiv") {
    return lookupArxiv(identifier.value);
  }

  return undefined;
}

async function lookupCrossRef(doi: string): Promise<ResolvedMetadata | undefined> {
  const response = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, {
    headers: {
      Accept: "application/json",
      "User-Agent": "LabShelf/0.0.1 (VS Code extension; mailto:contact@labshelf.dev)",
    },
  });

  if (!response.ok) {
    return undefined;
  }

  const payload = await response.json() as {
    message?: {
      title?: string[];
      author?: Array<{ given?: string; family?: string }>;
      issued?: { "date-parts"?: number[][] };
      "container-title"?: string[];
      publisher?: string;
      volume?: string;
      issue?: string;
      page?: string;
      DOI?: string;
      URL?: string;
      ISSN?: string[];
      language?: string;
      abstract?: string;
      "short-container-title"?: string[];
    };
  };

  const m = payload.message;
  if (!m) {
    return undefined;
  }

  // CrossRef abstract contains JATS XML markup — strip tags for plain text
  const abstractRaw = m.abstract;
  const abstractText = abstractRaw
    ? abstractRaw.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()
    : undefined;

  return {
    title: firstNonEmpty(m.title),
    authors: formatAuthorNames(m.author),
    year: firstYear(m.issued?.["date-parts"]),
    journal: firstNonEmpty(m["container-title"]),
    publisher: m.publisher?.trim() || undefined,
    volume: m.volume?.trim() || undefined,
    issue: m.issue?.trim() || undefined,
    pages: m.page?.trim() || undefined,
    doi: m.DOI?.trim() || undefined,
    url: m.URL?.trim() || undefined,
    issn: m.ISSN?.[0]?.trim() || undefined,
    language: m.language?.trim() || undefined,
    summary: abstractText || undefined,
  };
}

async function lookupArxiv(arxivId: string): Promise<ResolvedMetadata | undefined> {
  const response = await fetch(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(arxivId)}`);
  if (!response.ok) {
    return undefined;
  }

  const xml = await response.text();
  const entry = xml.match(/<entry>([\s\S]*?)<\/entry>/)?.[1];
  if (!entry) {
    return undefined;
  }

  const rawAbstract = matchXmlTag(entry, "summary");
  const abstractText = rawAbstract ? cleanupXmlText(rawAbstract) : undefined;

  return {
    title: cleanupXmlText(matchXmlTag(entry, "title")),
    authors: [...entry.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>\s*<\/author>/g)]
      .map((match) => cleanupXmlText(match[1] ?? ""))
      .filter((author): author is string => typeof author === "string" && author.length > 0),
    year: extractYear(matchXmlTag(entry, "published") ?? matchXmlTag(entry, "updated")),
    journal: "arXiv preprint",
    doi: cleanupXmlText(matchXmlTag(entry, "id")),
    url: cleanupXmlText(matchXmlTag(entry, "id")),
    summary: abstractText || undefined,
  };
}

// ─── Private helpers ───────────────────────────────────────────────────────────

function matchXmlTag(content: string, tagName: string): string | undefined {
  return content.match(new RegExp(`<${tagName}>([\\s\\S]*?)</${tagName}>`, "i"))?.[1];
}

function cleanupXmlText(value: string | undefined): string | undefined {
  return value?.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function firstNonEmpty(values: string[] | undefined): string | undefined {
  return values?.map((value) => value.trim()).find((value) => value.length > 0);
}

function formatAuthorNames(authors: Array<{ given?: string; family?: string }> | undefined): string[] {
  return (authors ?? [])
    .map((author) => [author.given, author.family].filter((part) => typeof part === "string" && part.trim().length > 0).join(" ").trim())
    .filter((author) => author.length > 0);
}

function firstYear(dateParts: number[][] | undefined): number | undefined {
  const year = dateParts?.[0]?.[0];
  return typeof year === "number" ? year : undefined;
}

function extractYear(rawValue: string | undefined): number | undefined {
  if (!rawValue) {
    return undefined;
  }
  const match = rawValue.match(/(?:(?:19|20)\d{2})/);
  return match ? Number(match[0]) : undefined;
}
