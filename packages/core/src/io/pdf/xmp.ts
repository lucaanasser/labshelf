/**
 * Reads bibliographic data out of a PDF's XMP packet. Publishers embed far
 * more there (journal, volume, issue, page range, DOI, ISSN) than in the
 * legacy Info dictionary, so XMP is the best offline metadata source when no
 * DOI can be resolved online.
 *
 * @depends io/pdf/types.ts
 * @dependents io/pdf/parser.ts
 */
import type { ResolvedMetadata, XmpMetadataLike } from "./types.js";

// XMP keys arrive with their namespace prefix (`dc:title`, `prism:doi`). Case
// and prefix spelling vary between producers, so lookups are normalized.
const AUTHOR_SEPARATOR = /\s*(?:;|\band\b|,(?=\s*[A-ZÀ-Þ][a-zà-ÿ]))\s*/;

/**
 * Converts a pdfjs Metadata object into the same shape online resolvers return.
 * @usedBy io/pdf/parser.ts
 * @returns Bibliographic fields found in the XMP packet, or undefined if empty.
 */
export function metadataFromXmp(xmp: XmpMetadataLike | null | undefined): ResolvedMetadata | undefined {
  const entries = readEntries(xmp);
  if (!entries) {
    return undefined;
  }

  const pick = (...keys: string[]): string | undefined => {
    for (const key of keys) {
      const value = flatten(entries.get(key));
      if (value) {
        return value;
      }
    }
    return undefined;
  };

  const result: ResolvedMetadata = {
    title: pick("dc:title", "pdf:title"),
    authors: splitAuthors(pick("dc:creator", "pdf:author", "xmp:author")),
    year: extractYear(pick("prism:coverdate", "prism:publicationdate", "dc:date", "prism:e-issn-date")),
    journal: pick("prism:publicationname", "dc:source", "bibo:journal"),
    publisher: pick("dc:publisher", "prism:corporateentity"),
    volume: pick("prism:volume"),
    issue: pick("prism:number", "prism:issueidentifier"),
    pages: pageRange(pick("prism:pagerange"), pick("prism:startingpage"), pick("prism:endingpage")),
    doi: normalizeDoi(pick("prism:doi", "crossmark:doi", "dc:identifier", "prism:url")),
    url: pick("prism:url", "xmp:identifier"),
    issn: pick("prism:issn", "prism:eissn"),
    language: pick("dc:language", "prism:language"),
    summary: pick("dc:description", "prism:teaser"),
  };

  return hasAnyValue(result) ? result : undefined;
}

// Normalizes the pdfjs Metadata surface (Map or plain object) into one lookup
// table keyed by lowercased `prefix:name`.
function readEntries(xmp: XmpMetadataLike | null | undefined): Map<string, unknown> | undefined {
  if (!xmp) {
    return undefined;
  }

  const raw = typeof xmp.getAll === "function" ? xmp.getAll() : undefined;
  if (!raw) {
    return undefined;
  }

  const pairs = raw instanceof Map ? [...raw.entries()] : Object.entries(raw);
  if (pairs.length === 0) {
    return undefined;
  }

  const entries = new Map<string, unknown>();
  for (const [key, value] of pairs) {
    entries.set(String(key).toLowerCase(), value);
  }
  return entries;
}

// XMP values may be scalars, rdf:Seq arrays, or language-alternative objects.
function flatten(value: unknown): string | undefined {
  if (typeof value === "string") {
    return collapse(value);
  }
  if (Array.isArray(value)) {
    const joined = value.map((entry) => flatten(entry)).filter(Boolean).join("; ");
    return collapse(joined);
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    // Language alternatives: prefer the default, then the first available.
    const preferred = record["x-default"] ?? Object.values(record)[0];
    return preferred === value ? undefined : flatten(preferred);
  }
  if (typeof value === "number") {
    return String(value);
  }
  return undefined;
}

function collapse(value: string): string | undefined {
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function splitAuthors(value: string | undefined): string[] | undefined {
  if (!value) {
    return undefined;
  }
  const authors = value
    .split(AUTHOR_SEPARATOR)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 1);
  return authors.length > 0 ? authors : undefined;
}

function pageRange(range: string | undefined, start: string | undefined, end: string | undefined): string | undefined {
  if (range) {
    return range;
  }
  if (start && end && start !== end) {
    return `${start}-${end}`;
  }
  return start ?? undefined;
}

// `dc:identifier` often holds `doi:10.x/y` or a doi.org URL rather than a bare DOI.
function normalizeDoi(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const match = value.match(/10\.\d{4,9}\/[^\s"<>]+/);
  return match ? match[0].replace(/[).,;:]+$/, "") : undefined;
}

function extractYear(value: string | undefined): number | undefined {
  const match = value?.match(/(?:19|20)\d{2}/);
  return match ? Number(match[0]) : undefined;
}

function hasAnyValue(metadata: ResolvedMetadata): boolean {
  return Object.values(metadata).some((value) =>
    Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null && value !== "",
  );
}
