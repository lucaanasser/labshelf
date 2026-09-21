/**
 * Layout heuristics for inferring title and authors from font-grouped text
 * blocks, plus DOI/arXiv identifier detection and shared string helpers.
 *
 * @depends io/pdf/types.ts
 * @dependents io/pdf/parser.ts
 */
import type { TextBlock, DetectedIdentifier } from "./types.js";
import { detectIdentifiers } from "./identifiers.js";

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
 * Detects the single most likely identifier in a PDF. Prefer
 * `detectIdentifiers` when you can try more than one candidate online.
 * @usedBy io/pdf/parser.ts
 * @returns The highest-ranked identifier, or undefined if none found.
 */
export function detectIdentifier(
  pdfInfo: Record<string, unknown>,
  text: string,
  linkUrls: string[] = [],
): DetectedIdentifier | undefined {
  return detectIdentifiers(pdfInfo, text, linkUrls)[0];
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

// Producers routinely dump the source filename or a print-job name into
// Info.Title ("15200863156991 1..46 - 28383.pdf", "Microsoft Word - ms.doc").
const FILENAME_TITLE = /\.(pdf|docx?|rtf|tex|ps|eps|indd|qxd|pages|odt)$/i;
const PLACEHOLDER_TITLE = /^(untitled|unknown|document\d*|no job name|microsoft word|print(out)?|paper|manuscript|main|ms|final|draft|template|layout|article)[\s\d.\-_]*$/i;

// A page printed from a viewer inherits the viewer's window title, not the
// paper's: Firefox stamps "PDF.js viewer" on everything printed from its reader.
const VIEWER_TITLE = /^(pdf\.?js viewer|pdf viewer|adobe (acrobat|reader)\b.*|preview|google (docs|drive)\b.*|(mozilla )?firefox|google chrome|safari|microsoft edge|about:blank|new tab)$/i;

/**
 * Reports whether a title from PDF metadata is a real title rather than a
 * filename, a print-job name, or a numeric identifier.
 * @usedBy io/pdf/parser.ts
 * @returns The cleaned title when usable, otherwise undefined.
 */
export function usableTitle(rawValue: string | undefined): string | undefined {
  const value = rawValue?.trim();
  if (!value || value.length < 6 || value.length > 400) {
    return undefined;
  }
  if (FILENAME_TITLE.test(value) || PLACEHOLDER_TITLE.test(value) || VIEWER_TITLE.test(value)) {
    return undefined;
  }

  const letters = (value.match(/[a-zà-ÿ]/gi) ?? []).length;
  // Mostly digits and separators — an internal article or job number.
  if (letters < value.length * 0.5) {
    return undefined;
  }
  // A single long unbroken token is a slug or an identifier, not a title.
  if (!/\s/.test(value) && value.length > 40) {
    return undefined;
  }
  return value;
}

// Function words across the languages LabShelf papers are most often written
// in. Natural prose is densely populated with them; text recovered from a PDF
// whose fonts lack a usable ToUnicode map is not.
const FUNCTION_WORDS = new Set([
  "the", "of", "and", "in", "to", "for", "with", "that", "this", "are", "was", "were", "from", "not",
  "we", "our", "have", "has", "been", "which", "these", "their", "between", "than", "also", "such", "here",
  "de", "da", "do", "das", "dos", "que", "para", "com", "uma", "como", "por", "mais", "foi", "ser", "nos",
  "la", "el", "los", "las", "una", "por", "para", "con", "del", "les", "des", "une", "dans", "sur", "est",
  "und", "der", "die", "das", "den", "von", "mit", "ist", "auf", "ein", "eine", "nicht", "auch", "dem",
]);

/**
 * Reports whether extracted PDF text reads as natural language. Returns true
 * when there is too little text to judge, so short documents are not rejected.
 * @usedBy io/pdf/parser.ts
 * @returns false only when the text is confidently unreadable (broken encoding).
 */
export function looksLikeNaturalText(text: string): boolean {
  const words = text.toLowerCase().match(/[a-zà-ÿ]{2,}/g) ?? [];
  if (words.length < 40) {
    return true;
  }

  let hits = 0;
  for (const word of words) {
    if (FUNCTION_WORDS.has(word)) {
      hits += 1;
    }
  }
  return hits / words.length >= 0.04;
}

// A paper's first page holds hundreds of words. Fewer than this on every page
// means the text layer is a print header or a download stamp laid over pages
// that are stored as images or outlines.
const MIN_PAGE_WORDS = 40;

/**
 * Reports whether the text layer is too thin to describe the paper — a scan,
 * or a page re-printed from a browser, which draws its glyphs as vector paths.
 * Judged per page: the same stamp on three pages is still only a stamp.
 * @usedBy io/pdf/parser.ts
 * @returns true when no page holds as many words as a real page of a paper.
 */
export function isSparseText(pageTexts: string[]): boolean {
  return pageTexts.every((text) => (text.match(/[a-zà-ÿ]{2,}/gi) ?? []).length < MIN_PAGE_WORDS);
}

// Tools that re-print an existing document stamp CreationDate with the moment
// the user saved the copy, which says nothing about when the paper was published.
const REPRINT_PRODUCERS = /quartz pdfcontext|skia\/pdf|preview|print to pdf|microsoft: print to pdf|cairo|ghostscript|pdfcreator|chrome|safari|firefox/i;

/**
 * Reports whether a PDF's timestamps reflect publication or merely the moment
 * someone re-saved the file, in which case the year must not be trusted.
 * @usedBy io/pdf/parser.ts
 * @returns true when CreationDate/ModDate are a usable year source.
 */
export function timestampsAreTrustworthy(pdfInfo: Record<string, unknown>): boolean {
  const producer = `${asString(pdfInfo["Producer"]) ?? ""} ${asString(pdfInfo["Creator"]) ?? ""}`;
  return !REPRINT_PRODUCERS.test(producer);
}

/**
 * Finds the publication year in the front matter of a paper (copyright line,
 * "Published/Received/Accepted" dates), which beats the PDF's file timestamp.
 * @usedBy io/pdf/parser.ts
 * @returns A four-digit year, or undefined when none is stated.
 */
export function yearFromText(text: string): number | undefined {
  const patterns = [
    /(?:©|\(c\)|copyright)\s*(?:the author[s]?[,\s]*)?((?:19|20)\d{2})/i,
    /\b(?:published|accepted|received|issued|revised)\b[^\n]{0,40}?\b((?:19|20)\d{2})\b/i,
    /\b(?:19|20)\d{2}\b(?=[^\n]{0,20}\b(?:vol|volume|issue|no\.)\b)/i,
  ];

  const currentYear = new Date().getFullYear();
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const year = Number(match?.[1] ?? match?.[0]);
    if (year >= 1900 && year <= currentYear + 1) {
      return year;
    }
  }
  return undefined;
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

  const parts = rawValue
    .split(/\s+and\s+|;\s*|\s*&\s*/i)
    .map((value) => value.trim())
    .filter(Boolean);

  // Info.Author often holds "Ann Lee, Bo Chen, Cy Diaz" — one entry to the
  // split above. Commas are only safe to break on when every piece still looks
  // like a full name, since "Lee, Ann" is one author written surname-first.
  if (parts.length === 1 && parts[0]) {
    const commaSeparated = parts[0]
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    if (commaSeparated.length > 2 && commaSeparated.every(looksLikeFullName)) {
      return commaSeparated;
    }
  }

  return parts;
}

// A full name carries at least a forename (or initial) and a surname.
function looksLikeFullName(value: string): boolean {
  return value.split(/\s+/).filter((word) => word.length > 0).length >= 2 && value.length <= 80;
}

const MAX_TITLE_KEY_LENGTH = 48;

/**
 * Builds a citation key from the best available source (identifier, title, or file stem) combined with the year.
 * The file stem comes last: it is whatever the user's download was called
 * ("artigo-1", "main"), which says nothing about the paper once a title is known.
 * @usedBy io/pdf/parser.ts
 * @returns A lowercase alphanumeric cite key string, optionally suffixed with the year.
 */
export function buildCiteKey(fileStem: string, title: string, year?: number, identifier?: string): string {
  const slug = (value: string): string =>
    value
      .normalize("NFD")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");

  // The key doubles as the paper's folder name, so a title-derived one is capped.
  const base = slug(identifier ?? "") || slug(title).slice(0, MAX_TITLE_KEY_LENGTH) || slug(fileStem);
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
