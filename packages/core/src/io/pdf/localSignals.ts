/**
 * Bibliographic signals recovered from the PDF's own content: the abstract and
 * keyword lines printed in the front matter, the journal name carried by a
 * running head, and the non-standard keys publishers stamp into the Info
 * dictionary. This is the last-resort layer, used when every online registry
 * fails, so nothing here touches the network, pdfjs, or the filesystem.
 *
 * @depends io/pdf/types.ts
 * @dependents io/pdf/parser.ts
 */
import type { ResolvedMetadata } from "./types.js";

// Headings that end the abstract. Matched case-sensitively — "since the
// introduction of the method" is prose, not a new section — and allowing the
// numbering styles journals print ("1 Introduction", "1. Introduction").
const SECTION_HEADINGS = ["Introduction", "Introdução", "Introducción", "Background", "Antecedentes"];
const KEYWORD_HEADINGS = ["Keywords", "Keyword", "Key words", "Index Terms", "Palavras-chave", "Palabras clave"];

const ABSTRACT_STOP = headingPattern([...SECTION_HEADINGS, ...KEYWORD_HEADINGS]);
const KEYWORDS_STOP = headingPattern([...SECTION_HEADINGS, "Abstract", "Resumo", "Resumen"]);

// The separator after the heading is unpredictable ("Abstract", "Abstract.",
// "Abstract:", "Abstract—") and the text layer sometimes swallows the space
// that followed it, so every delimiter is optional.
const ABSTRACT_HEADING = /(?:^|\n|\s)(?:abstract|summary|resumo|resumen)\b\s*[.:–—-]*\s*/gi;
// Groups: the character before the label, and the delimiter after it — the
// label only counts as a label when one of the two proves it is a heading.
const KEYWORDS_LABEL = /(^|\n|\s)(?:keywords?|key\s+words|index\s+terms|palavras[-\s]?chave|palabras\s+clave)\b\s*([.:–—-]*)\s*/gi;

// An abstract runs a few hundred words; anything shorter than the floor is a
// cross-reference ("see abstract") rather than the abstract itself.
const ABSTRACT_MAX_CHARS = 2500;
const ABSTRACT_MIN_CHARS = 120;
const KEYWORDS_MAX_CHARS = 400;
const KEYWORDS_MAX_COUNT = 15;

// Lines a masthead prints above the title: article-type labels, the journal's
// own branding, access badges, identifiers and submission dates.
const MASTHEAD_NOISE = /\b(research article|original (article|research|paper)|review article|short communication|open access|artigo original|artigo de revis[aã]o|journal|revista|proceedings|anais|issn|doi|vol(ume)?\.?\s*\d|received|accepted|published|recebido|aceito|publicado|citation|copyright|licen[sc]e|editor|correspond)/i;
const TITLE_MAX_LINES = 4;
const TITLE_MAX_CHARS = 300;

/**
 * Guesses the title from plain front-matter lines, for text that came from OCR
 * and so carries no font sizes to rank by. Deliberately strict: a wrong title
 * is worse than none, since none sends the record to review. Line shape alone
 * also fits a licence notice or a lead sentence, so a run of lines only counts
 * as the title when the byline comes directly after it.
 * @usedBy io/pdf/parser.ts
 * @returns The joined title lines, or undefined when no run qualifies.
 */
export function titleFromPlainText(text: string): string | undefined {
  const lines = text
    .split("\n")
    // A stamp running up the margin leaves a stray symbol or digit at the start
    // of each line it crosses ("= EFFICIENT ALGORITHMS", "5 GRAPH SEARCH").
    .map((line) => line.trim().replace(/^[^A-Za-zÀ-ÿ\s]{1,2}\s+(?=\S{3,})/, ""))
    // OCR turns rules, logos and margin stamps into one- or two-letter specks,
    // or into symbol soup ("[| | [_] [| -") that would split a title in two.
    .filter((line) => line.length >= 4 && mostlyLetters(line))
    .slice(0, 30);

  for (let start = 0; start < lines.length; start += 1) {
    const picked: string[] = [];
    let next = start;
    while (next < lines.length && picked.length < TITLE_MAX_LINES && looksLikeTitleLine(lines[next]!)) {
      picked.push(lines[next]!);
      next += 1;
      // A full stop closes a sentence, and a title does not run past one.
      if (/[.!?]$/.test(picked[picked.length - 1]!)) {
        break;
      }
    }

    const title = picked.join(" ");
    const followedByByline = next < lines.length && looksLikeByline(lines[next]!);
    if (followedByByline && title.split(/\s+/).length >= 3 && title.length <= TITLE_MAX_CHARS) {
      return collapse(title);
    }
  }
  return undefined;
}

function looksLikeTitleLine(line: string): boolean {
  if (line.length < 12 || line.length > 200 || MASTHEAD_NOISE.test(line) || looksLikeByline(line)) {
    return false;
  }
  if (/https?:|www\.|@|©/i.test(line) || /^(abstract|resumo|resumen|summary|keywords?|palavras)/i.test(line)) {
    return false;
  }
  // OCR of logos and rules yields symbol soup; a title is almost all letters.
  const letters = (line.match(/[a-zà-ÿ]/gi) ?? []).length;
  return letters >= line.replace(/\s/g, "").length * 0.8;
}

function mostlyLetters(line: string): boolean {
  const visible = line.replace(/\s/g, "").length;
  return (line.match(/[a-zà-ÿ]/gi) ?? []).length >= visible * 0.5;
}

// Names separated by commas, or carrying affiliation markers.
function looksLikeByline(line: string): boolean {
  const commas = (line.match(/,/g) ?? []).length;
  const capitalized = (line.match(/\b[A-ZÀ-Þ][a-zà-ÿ]+/g) ?? []).length;
  const words = line.split(/\s+/).length;
  if (commas >= 2 && capitalized >= words * 0.6) {
    return true;
  }
  if (/[*†‡§¹²³]|\b[A-Z]\.\s?[A-Z][a-z]+/.test(line) && capitalized >= words * 0.6) {
    return true;
  }
  return namesJoinedByAnd(line);
}

const NAME_WORD = /^[A-ZÀ-Þ][a-zà-ÿ'’-]+[*†‡§¹²³0-9,]*$/;
const INITIAL = /^[A-ZÀ-Þ]\.?[*†‡§¹²³0-9,]*$/;
const CONNECTIVE = /^(and|&|e|y|und|et)$/i;

// "Ville Mustonen and Michael Lassig": nothing but capitalised names and
// initials around a connective. Title-cased titles keep their lowercase
// function words ("for", "of"), so they do not pass for one.
function namesJoinedByAnd(line: string): boolean {
  const words = line.trim().split(/\s+/);
  if (words.length < 3 || words.length > 14 || !words.some((word) => CONNECTIVE.test(word))) {
    return false;
  }
  const names = words.filter((word) => !CONNECTIVE.test(word));
  return names.length >= 2 && names.every((word) => NAME_WORD.test(word) || INITIAL.test(word));
}

/**
 * Reads the abstract printed in a paper's front matter, for use as the summary
 * when no registry returned one.
 * @usedBy io/pdf/parser.ts
 * @returns The abstract with whitespace collapsed, or undefined when absent.
 */
export function abstractFromText(text: string): string | undefined {
  if (!text) {
    return undefined;
  }

  // The word "abstract" also occurs in prose, so every occurrence is tried and
  // the first one followed by enough text to be an abstract wins.
  const heading = new RegExp(ABSTRACT_HEADING.source, ABSTRACT_HEADING.flags);
  let match: RegExpExecArray | null;
  while ((match = heading.exec(text)) !== null) {
    const start = match.index + match[0].length;
    const window = text.slice(start, start + ABSTRACT_MAX_CHARS);
    const body = collapse(window.slice(0, stopIndex(window, ABSTRACT_STOP)));
    if (body && body.length >= ABSTRACT_MIN_CHARS) {
      return body;
    }
  }
  return undefined;
}

/**
 * Reads the author-supplied keyword list printed below the abstract.
 * @usedBy io/pdf/parser.ts
 * @returns Up to 15 deduplicated keywords, or an empty array when absent.
 */
export function keywordsFromText(text: string): string[] {
  if (!text) {
    return [];
  }

  const label = new RegExp(KEYWORDS_LABEL.source, KEYWORDS_LABEL.flags);
  let match: RegExpExecArray | null;
  while ((match = label.exec(text)) !== null) {
    // "keyword" also occurs mid-sentence, so the word is only treated as a
    // label when it opens a line or is followed by a delimiter.
    const isHeading = match.index === 0 || match[1] === "\n" || Boolean(match[2]);
    if (!isHeading) {
      continue;
    }

    const start = match.index + match[0].length;
    const window = text.slice(start, start + KEYWORDS_MAX_CHARS);
    const run = collapse(window.slice(0, stopIndex(window, KEYWORDS_STOP))) ?? "";
    const keywords = splitKeywords(run);
    if (keywords.length > 0) {
      return keywords;
    }
  }
  return [];
}

/**
 * Infers the journal name from the running header/footer, which is the only
 * place many scanned or DOI-less PDFs name their venue.
 * @usedBy io/pdf/parser.ts
 * @returns The line repeated on the most pages, or undefined when none repeats.
 */
export function journalFromRunningHead(pageTexts: string[]): string | undefined {
  // Counted per page, not per occurrence: a line printed twice on one page is
  // still a single piece of evidence.
  const pageCounts = new Map<string, number>();
  for (const pageText of pageTexts) {
    const seenHere = new Set<string>();
    for (const line of pageText.split(/\r?\n/)) {
      const candidate = runningHeadCandidate(line);
      if (candidate) {
        seenHere.add(candidate);
      }
    }
    for (const candidate of seenHere) {
      pageCounts.set(candidate, (pageCounts.get(candidate) ?? 0) + 1);
    }
  }

  let best: string | undefined;
  // Starts at 1 so a line seen on a single page is never accepted.
  let bestCount = 1;
  for (const [candidate, count] of pageCounts) {
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Harvests the non-standard Info dictionary keys publishers stamp into their
 * PDFs (`WPS-ARTICLEDOI`, `JournalTitle`, `FirstPage`, …), which carry real
 * bibliographic data the standard keys never do.
 * @usedBy io/pdf/parser.ts
 * @returns The fields found, or undefined when the dictionary holds none.
 */
export function publisherMetadataFromInfo(pdfInfo: Record<string, unknown>): ResolvedMetadata | undefined {
  const entries = lowercaseEntries(pdfInfo);
  if (entries.size === 0) {
    return undefined;
  }

  const pick = (...keys: string[]): string | undefined => {
    for (const key of keys) {
      const value = entries.get(key);
      if (value) {
        return value;
      }
    }
    return undefined;
  };

  // Vendors prefix their DOI key with a product code, so it is matched by
  // substring while the bare `doi` key is matched exactly.
  const doi = extractDoi(findByFragment(entries, "articledoi") ?? pick("doi"));
  const firstPage = pick("firstpage");
  const lastPage = pick("lastpage");
  const year = extractYear(pick("copyright"));

  const result: ResolvedMetadata = {};
  // Built key by key: under exactOptionalPropertyTypes an absent field must be
  // omitted, not set to undefined.
  if (doi) {
    result.doi = doi;
  }
  const journal = pick("journaltitle", "journal", "publicationtitle");
  if (journal) {
    result.journal = journal;
  }
  const volume = pick("volumenum", "volume");
  if (volume) {
    result.volume = volume;
  }
  const issue = pick("issuenum", "issue", "number");
  if (issue) {
    result.issue = issue;
  }
  const pages = firstPage && lastPage && firstPage !== lastPage ? `${firstPage}-${lastPage}` : firstPage;
  if (pages) {
    result.pages = pages;
  }
  const issn = pick("issn");
  if (issn) {
    result.issn = issn;
  }
  const publisher = pick("publisher");
  if (publisher) {
    result.publisher = publisher;
  }
  if (year !== undefined) {
    result.year = year;
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Scores how complete a candidate record is, so two fallback records can be
 * compared without ranking one field above another.
 * @usedBy io/pdf/parser.ts
 * @returns The number of populated fields; empty arrays and blanks do not count.
 */
export function describeFallback(metadata: ResolvedMetadata): number {
  let filled = 0;
  for (const value of Object.values(metadata)) {
    if (Array.isArray(value)) {
      if (value.length > 0) {
        filled += 1;
      }
    } else if (typeof value === "string") {
      if (value.trim().length > 0) {
        filled += 1;
      }
    } else if (value !== undefined && value !== null) {
      filled += 1;
    }
  }
  return filled;
}

// Headings are printed either in title case or all caps; both spellings are
// listed so the pattern can stay case-sensitive and ignore running prose.
function headingPattern(words: string[]): RegExp {
  const alternatives = words.flatMap((word) => [word, word.toUpperCase()]).join("|");
  return new RegExp(`(?:^|\\n|\\s)(?:\\d{1,2}\\s*[.)]?\\s*)?(?:${alternatives})\\b`);
}

// Where the extracted run ends: at the next heading, or at the window's end.
function stopIndex(window: string, stop: RegExp): number {
  const match = window.match(stop);
  return match?.index !== undefined ? match.index : window.length;
}

function splitKeywords(run: string): string[] {
  const seen = new Set<string>();
  const keywords: string[] = [];

  for (const part of run.split(/[,;·]/)) {
    const keyword = part.trim().replace(/[.;:,]+$/, "").trim();
    if (keyword.length < 2 || keyword.length > 60) {
      continue;
    }
    const fingerprint = keyword.toLowerCase();
    if (seen.has(fingerprint)) {
      continue;
    }
    seen.add(fingerprint);
    keywords.push(keyword);
    if (keywords.length === KEYWORDS_MAX_COUNT) {
      break;
    }
  }
  return keywords;
}

function runningHeadCandidate(rawLine: string): string | undefined {
  const line = collapse(rawLine);
  if (!line || line.length > 120) {
    return undefined;
  }
  if (/^(page\s*)?\d+(\s*of\s*\d+)?$/i.test(line)) {
    return undefined;
  }

  // Pagination travels with the running head and changes on every page, so it
  // is stripped before candidates are compared.
  const stripped = line
    .replace(/\s*[|·]?\s*\d+\s+of\s+\d+\s*$/i, "")
    .replace(/^\d{1,4}\s+/, "")
    .replace(/\s+\d{1,4}$/, "")
    .replace(/^[|·•–—-]+|[|·•–—-]+$/g, "")
    .trim();

  if (stripped.length < 6 || stripped.length > 120) {
    return undefined;
  }
  // Mostly digits: a page range, a date line, or an internal article number.
  const digits = (stripped.match(/\d/g) ?? []).length;
  if (digits > stripped.length * 0.4) {
    return undefined;
  }
  return stripped;
}

function lowercaseEntries(pdfInfo: Record<string, unknown>): Map<string, string> {
  const entries = new Map<string, string>();
  for (const [key, value] of Object.entries(pdfInfo ?? {})) {
    const text = typeof value === "string" ? value.trim() : "";
    const normalized = key.toLowerCase();
    if (text && !entries.has(normalized)) {
      entries.set(normalized, text);
    }
  }
  return entries;
}

function findByFragment(entries: Map<string, string>, fragment: string): string | undefined {
  for (const [key, value] of entries) {
    if (key.includes(fragment)) {
      return value;
    }
  }
  return undefined;
}

function extractDoi(value: string | undefined): string | undefined {
  const match = value?.match(/10\.\d{4,9}\/[^\s"<>]+/);
  return match ? match[0].replace(/[).,;:]+$/, "") : undefined;
}

function extractYear(value: string | undefined): number | undefined {
  const match = value?.match(/(?:19|20)\d{2}/);
  return match ? Number(match[0]) : undefined;
}

function collapse(value: string): string | undefined {
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
