/**
 * Reads a paper folder's metadata.yaml into a PaperRecord: the id is the folder name (== cite key), the title falls
 * back to the id, and hasPdf comes from the folder listing, never from the file. Every app that reads the library
 * from disk shares this so a paper looks the same everywhere.
 */
import YAML from "yaml";

import { isPaperStatus, parseTextLayerInfo, type PaperRecord } from "../model/index.js";

const OPTIONAL_STRING_FIELDS = [
  "summary", "journal", "publisher", "volume", "issue", "pages", "doi", "url", "issn", "language",
] as const;

export interface PaperLocation {
  /** Folder name, which is the paper id. */
  id: string;
  /** Absolute path of the paper folder on this device. */
  path: string;
  /** Whether <folder>/paper.pdf exists on this device. */
  hasPdf: boolean;
}

/**
 * Parses metadata.yaml text.
 * @returns the mapping, or undefined when the text is not a YAML mapping
 */
export function parsePaperMetadata(text: string): Record<string, unknown> | undefined {
  try {
    const parsed = YAML.parse(text) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Builds the record of one paper from its parsed metadata.yaml.
 * @returns the PaperRecord
 */
export function paperRecordFromMetadata(meta: Record<string, unknown>, location: PaperLocation): PaperRecord {
  const authors = stringList(meta["authors"]);
  const keywords = stringList(meta["keywords"]);
  const tags = stringList(meta["tags"]);
  const textLayer = parseTextLayerInfo(meta["textLayer"]);
  const status = meta["status"];
  const record: PaperRecord = {
    id: location.id,
    title: typeof meta["title"] === "string" ? meta["title"] : location.id,
    path: location.path,
    citeKey: typeof meta["citekey"] === "string" ? meta["citekey"] : location.id,
    status: isPaperStatus(status) ? status : "unread",
    hasPdf: location.hasPdf,
  };
  if (authors.length) { record.authors = authors; }
  if (typeof meta["year"] === "number") { record.year = meta["year"]; }
  for (const key of OPTIONAL_STRING_FIELDS) {
    const value = meta[key];
    if (typeof value === "string") { record[key] = value; }
  }
  if (keywords.length) { record.keywords = keywords; }
  if (textLayer) { record.textLayer = textLayer; }
  if (tags.length) { record.tags = tags; }
  if (typeof meta["note"] === "string") { record.note = meta["note"]; }
  return record;
}

// Keeps the string entries of a YAML list; anything else yields an empty list.
function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}
