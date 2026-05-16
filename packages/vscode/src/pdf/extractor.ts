/**
 * Extracts text blocks from a PDF document and infers title, authors, and identifiers (DOI/arXiv) via layout heuristics.
 *
 * @depends pdf/types.ts
 * @dependents pdf/parser.ts
 */
import type { TextBlock, DetectedIdentifier } from "./types.js";

// ─── Text extraction ───────────────────────────────────────────────────────────

/**
 * Groups page-1 text items into runs that share the same font size, in reading order.
 * @usedBy pdf/parser.ts
 * @returns Array of TextBlock objects representing font-grouped text runs.
 */
export async function extractTitleBlocks(document: any): Promise<TextBlock[]> {
  const page = await document.getPage(1);
  const content = await page.getTextContent();
  const items = content.items as Array<{ str?: string; transform?: number[] }>;

  const blocks: TextBlock[] = [];
  for (const item of items) {
    const str = item.str ?? "";
    if (!str.trim()) { continue; }
    const transform = item.transform ?? [1, 0, 0, 1, 0, 0];
    const size = Math.round(Math.hypot(transform[2] ?? 0, transform[3] ?? 1) * 10) / 10;

    const last = blocks[blocks.length - 1];
    if (last && Math.abs(last.size - size) < 1) {
      last.text += /\s$/.test(last.text) || /^\s/.test(str) ? str : ` ${str}`;
    } else {
      blocks.push({ size, text: str });
    }
  }

  return blocks
    .map((block) => ({ size: block.size, text: block.text.replace(/\s+/g, " ").trim() }))
    .filter((block) => block.text.length > 0);
}

/**
 * Concatenates the plain text from the first `pageCount` pages of the PDF document.
 * @usedBy pdf/parser.ts
 * @returns Newline-joined string of page text, used for identifier detection.
 */
export async function extractFirstPagesText(document: any, pageCount: number): Promise<string> {
  const chunks: string[] = [];
  const limit = Math.min(document.numPages ?? pageCount, pageCount);

  for (let pageNumber = 1; pageNumber <= limit; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const textContent = await page.getTextContent({ normalizeWhitespace: true });
    const pageText = textContent.items
      .map((item: { str?: string }) => item.str ?? "")
      .join(" ")
      .trim();
    if (pageText) {
      chunks.push(pageText);
    }
  }

  return chunks.join("\n");
}

// ─── Title / author heuristics ─────────────────────────────────────────────────

/**
 * Returns the title by picking the largest-font text run from the first eight blocks of page 1.
 * @usedBy pdf/parser.ts
 * @returns The inferred title string, or undefined if no suitable block is found.
 */
export function titleFromBlocks(blocks: TextBlock[]): string | undefined {
  const head = blocks.slice(0, 8);
  if (head.length === 0) { return undefined; }

  let best = head[0]!;
  for (const block of head) {
    if (block.size > best.size) { best = block; }
  }

  const bodySize = medianSize(blocks);
  if (best.size <= bodySize * 1.15) { return undefined; }
  if (best.text.length < 6 || best.text.length > 400) { return undefined; }
  return best.text;
}

/**
 * Scans the blocks immediately below the title block and returns parsed author names.
 * @usedBy pdf/parser.ts
 * @returns Array of author name strings, or empty array if no author line is detected.
 */
export function authorsFromBlocks(blocks: TextBlock[], title: string | undefined): string[] {
  if (!title) { return []; }
  const titleIndex = blocks.findIndex((block) => block.text === title);
  if (titleIndex < 0) { return []; }

  for (let i = titleIndex + 1; i < Math.min(blocks.length, titleIndex + 4); i += 1) {
    const candidate = blocks[i]!;
    if (looksLikeAuthorLine(candidate.text)) {
      return normalizeAuthors(candidate.text);
    }
  }
  return [];
}

function looksLikeAuthorLine(text: string): boolean {
  if (text.length < 4 || text.length > 200) { return false; }
  if (/\.\s+[a-z]/.test(text)) { return false; }
  if (/\b(abstract|introduction|university|department|institut|faculty|laborat)/i.test(text)) {
    return false;
  }
  return /[A-ZÀ-Þ][a-zà-ÿ]+/.test(text);
}

function medianSize(blocks: TextBlock[]): number {
  if (blocks.length === 0) { return 0; }
  const sizes = blocks.map((block) => block.size).sort((a, b) => a - b);
  return sizes[Math.floor(sizes.length / 2)] ?? 0;
}

// ─── Identifier detection ──────────────────────────────────────────────────────

/**
 * Detects a DOI or arXiv identifier from PDF metadata fields and the first-pages text.
 * @usedBy pdf/parser.ts
 * @returns A DetectedIdentifier with type and value, or undefined if none found.
 */
export function detectIdentifier(pdfInfo: Record<string, unknown>, text: string): DetectedIdentifier | undefined {
  const candidate = asString(pdfInfo.DOI) ?? findDoi(text);
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

// ─── Shared string helpers ─────────────────────────────────────────────────────

/**
 * Normalizes a raw title string by collapsing underscores, hyphens, and whitespace.
 * @usedBy pdf/parser.ts
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
 * @usedBy pdf/parser.ts
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
 * @usedBy pdf/parser.ts
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
 * @usedBy pdf/parser.ts
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
 * @usedBy pdf/parser.ts
 * @returns The trimmed string, or undefined.
 */
export function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stripTrailingPunctuation(value: string): string {
  return value.replace(/[)\].,;:]+$/g, "");
}
