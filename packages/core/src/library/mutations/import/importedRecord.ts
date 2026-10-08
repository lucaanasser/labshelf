/** Builds paper records from bibliographic metadata, whether parsed from a PDF or resolved from a registry. */
import type { PaperRecord } from "../../../model/index.js";

/** The bibliographic fields a record takes; the io PDF parser's and registries' results satisfy it. */
export interface RecordMetadata {
  title?: string | undefined;
  authors?: string[] | undefined;
  year?: number | undefined;
  summary?: string | undefined;
  journal?: string | undefined;
  publisher?: string | undefined;
  volume?: string | undefined;
  issue?: string | undefined;
  pages?: string | undefined;
  doi?: string | undefined;
  url?: string | undefined;
  issn?: string | undefined;
  language?: string | undefined;
  keywords?: string[] | undefined;
}

/** What an import needs from parsing a PDF; `PdfImportParser.parse` returns a superset. */
export interface ParsedImport extends RecordMetadata {
  title: string;
  citeKey: string;
  confidence?: string | undefined;
  source?: string | undefined;
}

const STRING_FIELDS = [
  "summary", "journal", "publisher", "volume", "issue", "pages", "doi", "url", "issn", "language",
] as const;

/** @returns the non-empty bibliographic fields of `meta`, without the title */
export function metadataFields(meta: RecordMetadata): Partial<PaperRecord> {
  const out: Partial<PaperRecord> = {};
  if (meta.authors?.length) { out.authors = meta.authors; }
  if (meta.year) { out.year = meta.year; }
  for (const key of STRING_FIELDS) {
    const value = meta[key];
    if (value) { out[key] = value; }
  }
  if (meta.keywords?.length) { out.keywords = meta.keywords; }
  return out;
}

/** @returns the record of a PDF just copied into `folder`, so it always has one */
export function importedRecord(id: string, folder: string, parsed: ParsedImport): PaperRecord {
  return { id, title: parsed.title, path: folder, citeKey: id, status: "unread", hasPdf: true, ...metadataFields(parsed) };
}

/**
 * Overwrites a record's bibliographic fields with resolved ones. Identity fields stay: the folder is named after the
 * cite key.
 * @returns the updated record
 */
export function withResolvedMetadata(record: PaperRecord, meta: RecordMetadata): PaperRecord {
  return { ...record, ...(meta.title ? { title: meta.title } : {}), ...metadataFields(meta) };
}

/**
 * A record is worth reviewing when no registry confirmed it: the title and authors then come from the PDF's own
 * layout or its file name.
 * @returns true when the user should check the metadata
 */
export function needsReview(parsed: Pick<ParsedImport, "confidence" | "doi">): boolean {
  return parsed.confidence !== "high" && !parsed.doi;
}
