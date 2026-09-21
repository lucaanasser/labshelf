/**
 * Combines everything known about a paper into one record, field by field.
 *
 * No single source is complete: CrossRef has the volume and page range but
 * often no abstract, Semantic Scholar has the abstract but a thinner venue,
 * XMP has the ISSN, and the PDF's own text has the keywords. Taking the first
 * source that answers would throw most of that away, so each field is filled
 * independently from the most trustworthy source that actually has it.
 *
 * @depends io/pdf/types.ts
 * @dependents io/pdf/parser.ts, io/pdf/resolver.ts
 */
import type { ResolvedMetadata } from "./types.js";

/**
 * How much a source is trusted, relative to the others. Higher wins a field.
 * The scale is deliberately sparse so new sources can slot between these.
 */
export const SOURCE_TRUST = {
  /** A registry record reached through an identifier printed in the PDF. */
  confirmedIdentifier: 100,
  /** A second registry queried with that already-confirmed identifier. */
  enrichment: 90,
  /** A registry record found by searching, and accepted by title agreement. */
  search: 70,
  /** The PDF's own XMP packet. */
  xmp: 60,
  /** Publisher-specific keys in the legacy Info dictionary. */
  publisherInfo: 50,
  /** Text read off the page: abstract, keywords, running head. */
  pdfText: 30,
  /** Standard Info dictionary fields. */
  info: 20,
  /** Font-size and position heuristics on page 1. */
  layout: 10,
} as const;

export interface MetadataSource {
  name: string;
  trust: number;
  metadata: ResolvedMetadata | undefined;
}

export interface MergedMetadata {
  metadata: ResolvedMetadata;
  /** Which source each populated field came from, for logs and diagnostics. */
  fieldSources: Record<string, string>;
}

const MERGE_FIELDS = [
  "title",
  "authors",
  "year",
  "journal",
  "publisher",
  "volume",
  "issue",
  "pages",
  "doi",
  "url",
  "issn",
  "language",
  "summary",
] as const;

/**
 * Merges every source into one record, taking each field from the most
 * trustworthy source that has a usable value for it.
 * @usedBy io/pdf/parser.ts
 * @returns The combined metadata plus a per-field record of where it came from.
 */
export function mergeMetadata(sources: MetadataSource[]): MergedMetadata {
  const ranked = sources
    .filter((source): source is MetadataSource & { metadata: ResolvedMetadata } => Boolean(source.metadata))
    .sort((a, b) => b.trust - a.trust);

  const metadata: Record<string, unknown> = {};
  const fieldSources: Record<string, string> = {};

  for (const field of MERGE_FIELDS) {
    for (const source of ranked) {
      const value = source.metadata[field];
      if (!isUsable(value)) {
        continue;
      }
      // A longer author list from an equally-trusted source is more complete,
      // but trust order still decides between different rankings.
      metadata[field] = value;
      fieldSources[field] = source.name;
      break;
    }
  }

  return { metadata: metadata as ResolvedMetadata, fieldSources };
}

/**
 * Counts how many fields of a record carry a usable value, so two candidate
 * records can be compared on completeness.
 * @usedBy io/pdf/parser.ts, io/pdf/resolver.ts
 * @returns Number of populated fields.
 */
export function completeness(metadata: ResolvedMetadata | undefined): number {
  if (!metadata) {
    return 0;
  }
  return MERGE_FIELDS.reduce((count, field) => count + (isUsable(metadata[field]) ? 1 : 0), 0);
}

function isUsable(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  return typeof value === "number" ? Number.isFinite(value) : false;
}
