/**
 * Layout heuristics for inferring title and authors from font-grouped text
 * blocks, plus DOI/arXiv identifier detection and shared string helpers.
 *
 * @depends io/pdf/types.ts
 * @dependents io/pdf/parser.ts
 */
import type { TextBlock, DetectedIdentifier } from "./types.js";

/**
 * Returns the title by picking the largest-font text run from the first eight blocks of page 1.
 * @usedBy io/pdf/parser.ts
 * @returns The inferred title string, or undefined if no suitable block is found.
 */
export function titleFromBlocks(blocks: TextBlock[]): string | undefined {
  const head = blocks.slice(0, 8);
  if (head.length === 0) {
    return undefined;
  }

  let best = head[0]!;
  for (const block of head) {
    if (block.size > best.size) {
      best = block;
    }
  }

  const bodySize = medianSize(blocks);
  if (best.size <= bodySize * 1.15) {
    return undefined;
  }
  if (best.text.length < 6 || best.text.length > 400) {
    return undefined;
  }
  return best.text;
}

/**
 * Scans the blocks immediately below the title block and returns parsed author names.
 * @usedBy io/pdf/parser.ts
 * @returns Array of author name strings, or empty array if no author line is detected.
 */
export function authorsFromBlocks(blocks: TextBlock[], title: string | undefined): string[] {
  if (!title) {
    return [];
  }
  const titleIndex = blocks.findIndex((block) => block.text === title);
  if (titleIndex < 0) {
    return [];
  }

  for (let i = titleIndex + 1; i < Math.min(blocks.length, titleIndex + 4); i += 1) {
    const candidate = blocks[i]!;
    if (looksLikeAuthorLine(candidate.text)) {
      return normalizeAuthors(candidate.text);
    }
  }
  return [];
}

function looksLikeAuthorLine(text: string): boolean {
  if (text.length < 4 || text.length > 200) {
    return false;
  }
  if (/\.\s+[a-z]/.test(text)) {
    return false;
  }
  if (/\b(abstract|introduction|university|department|institut|faculty|laborat)/i.test(text)) {
    return false;
  }
  return /[A-ZÀ-Þ][a-zà-ÿ]+/.test(text);
}

function medianSize(blocks: TextBlock[]): number {
  if (blocks.length === 0) {
    return 0;
  }
  const sizes = blocks.map((block) => block.size).sort((a, b) => a - b);
  return sizes[Math.floor(sizes.length / 2)] ?? 0;
}

/**
 * Detects a DOI or arXiv identifier from PDF metadata fields and the first-pages text.
 * @usedBy io/pdf/parser.ts
 * @returns A DetectedIdentifier with type and value, or undefined if none found.
 */
export function detectIdentifier(pdfInfo: Record<string, unknown>, text: string): DetectedIdentifier | undefined {
  const candidate = asString(pdfInfo["DOI"]) ?? findDoi(text);
  if (candidate) {
    return { type: "doi", value: candidate };
  }

  const arxivCandidate = findArxivId(text);
  if (arxivCandidate) {
    return { type: "arxiv", value: arxivCandidate };
  }

  return undefined;
}

function findDoi(text: string): string | undefined {
  const match = text.match(/\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+\b/i);
  return match ? stripTrailingPunctuation(match[0]) : undefined;
}

function findArxivId(text: string): string | undefined {
  const match = text.match(/\b(?:arXiv:\s*)?(\d{4}\.\d{4,5})(?:v\d+)?\b/i);
  return match?.[1];
}

/**
 * Normalizes a raw title string by collapsing underscores, hyphens, and whitespace.
 * @usedBy io/pdf/parser.ts
 * @returns The cleaned title string.
 */
export function normalizeTitle(rawValue: string): string {
  return rawValue
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Splits an author string (or passes through an array) into individual trimmed author names.
 * @usedBy io/pdf/parser.ts
 * @returns Array of non-empty author name strings.
 */
export function normalizeAuthors(rawValue: string | string[] | undefined): string[] {
  if (Array.isArray(rawValue)) {
    return rawValue.map((value) => value.trim()).filter(Boolean);
  }

  if (!rawValue) {
    return [];
  }

  return rawValue
    .split(/\s+and\s+|;\s*|\s*&\s*/i)
    .map((value) => value.trim())
    .filter(Boolean);
}

/**
 * Builds a citation key from the best available source (identifier, file stem, or title) combined with the year.
 * @usedBy io/pdf/parser.ts
 * @returns A lowercase alphanumeric cite key string, optionally suffixed with the year.
 */
export function buildCiteKey(fileStem: string, title: string, year?: number, identifier?: string): string {
  const sourceKey = identifier ?? fileStem ?? title;
  const base = sourceKey
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
  return year ? `${base}${year}` : base;
}

/**
 * Extracts a four-digit year (1900–2099) from a raw date string such as a PDF creation date.
 * @usedBy io/pdf/parser.ts
 * @returns The year as a number, or undefined if no match is found.
 */
export function extractYear(rawValue: string | undefined): number | undefined {
  if (!rawValue) {
    return undefined;
  }

  const match = rawValue.match(/(?:(?:19|20)\d{2})/);
  return match ? Number(match[0]) : undefined;
}

/**
 * Coerces an unknown value to a non-empty trimmed string, returning undefined for blanks and non-strings.
 * @usedBy io/pdf/parser.ts
 * @returns The trimmed string, or undefined.
 */
export function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stripTrailingPunctuation(value: string): string {
  return value.replace(/[)\].,;:]+$/g, "");
}
