/**
 * Finds the References section and splits it into entries so a citation hover can show the cited work.
 * Deliberately conservative: when the layout is ambiguous it returns nothing, and the hover falls back to a cropped image of the destination rather than showing the wrong reference.
 *
 * @depends webview/logic/textLines.ts, webview/logic/inTextRefs.ts
 * @dependents webview/ui/citationResolver.ts
 */
import { foldText } from "./inTextRefs.js";
import type { TextLine } from "./textLines.js";

// Compared after folding case and accents: OCR run with English language data turns "REFERÊNCIAS" into "REFERENCIAS".
const HEADINGS = new Set([
  "references", "reference list", "references and notes", "references cited", "cited references", "literature cited",
  "works cited", "bibliography", "literature",
  "referencias", "referencias bibliograficas", "referencias citadas", "bibliografia", "obras citadas", "literatura citada",
  "references bibliographiques", "bibliographie", "literatur", "literaturverzeichnis", "riferimenti bibliografici",
]);

/**
 * @usedBy findReferencesStart
 * @returns true when a line is the heading of the reference list, in any of the supported languages.
 */
export function isReferencesHeading(raw: string): boolean {
  let text = raw.trim();
  if (text.length === 0 || text.length > 48) { return false; }
  // Letter-spaced display headings: "R E F E R E N C E S".
  if (/^(?:\p{L}\s){3,}\p{L}$/u.test(text)) { text = text.replace(/\s+/g, ""); }
  const folded = foldText(text)
    .replace(/^(?:\d{1,2}|[ivxl]{1,5})\s*[.)\-–]?\s+/, "")
    .replace(/[\s.:;\-–—]+$/, "")
    .replace(/\s+/g, " ");
  return HEADINGS.has(folded);
}

/**
 * @usedBy webview/ui/citationResolver.ts
 * @returns the index of the heading line, or -1.
 */
export function findReferencesStart(lines: readonly TextLine[]): number {
  for (let i = 0; i < lines.length; i++) {
    if (isReferencesHeading(lines[i]!.text)) { return i; }
  }
  return -1;
}

export interface ReferenceEntry {
  text: string;
  /** Number from a leading "[12]", "12." or "(12)" marker, when present. */
  number: number | null;
  column: number;
  x: number;
  /** Baseline of the entry's first and last lines, PDF space (first > last). */
  yFirst: number;
  yLast: number;
  lineHeight: number;
}

// "[12]", "(12)", "12." and "12)" — plus the mixed pairs OCR produces, such as "[12)" or "(12]".
const MARKER = /^(?:[[(]\s*([0-9lI|Oo]{1,3})\s*[\])]|([0-9lI|Oo]{1,3})[.)])(?=\s|$)/;

function markerNumber(text: string): number | null {
  const m = MARKER.exec(text);
  const token = m?.[1] ?? m?.[2];
  if (!token || !/\d/.test(token) && !/^[lI|]$/.test(token)) { return null; }
  const n = Number(token.replace(/[lI|]/g, "1").replace(/[Oo]/g, "0"));
  return Number.isInteger(n) && n > 0 ? n : null;
}

function appendLine(acc: string, next: string): string {
  if (!acc) { return next; }
  // A hyphen at a line end is almost always layout hyphenation in a reference list.
  if (/\p{L}-$/u.test(acc) && /^\p{Ll}/u.test(next)) { return acc.slice(0, -1) + next; }
  return `${acc} ${next}`;
}

// OCR reads a closing bracket as 1, l, I or |: "[71 ———, Dynamic data…" is entry 7. Only the list's own numbering can
// tell that from a real 71, so such a marker is accepted solely as the successor of the entry before it.
const LOOSE_MARKER = /^\[\s*([0-9lI|Oo]{1,2})[1lI|](?=\s)/;

function looseMarkerNumber(text: string, previous: number | null): number | null {
  const m = LOOSE_MARKER.exec(text);
  if (!m || previous === null) { return null; }
  return markerNumber(`[${m[1]!}]`) === previous + 1 ? previous + 1 : null;
}

function build(group: TextLine[], looseNumber: number | null = null): ReferenceEntry {
  const first = group[0]!;
  const last = group[group.length - 1]!;
  let text = group.reduce((acc, l) => appendLine(acc, l.text), "");
  if (looseNumber !== null) { text = text.replace(LOOSE_MARKER, `[${looseNumber}]`); }
  return {
    text,
    number: looseNumber ?? markerNumber(first.text),
    column: first.column,
    x: first.x,
    yFirst: first.y,
    yLast: last.y,
    lineHeight: first.height,
  };
}

/**
 * Splits reference-section lines (already in reading order) into entries.
 * Numbered lists split on their markers; unnumbered lists split on hanging indent. Anything else yields no entries.
 * @usedBy webview/ui/citationResolver.ts
 * @returns the entries, or [] when no reliable boundary signal exists.
 */
export function splitReferenceEntries(lines: readonly TextLine[]): ReferenceEntry[] {
  if (lines.length === 0) { return []; }
  const numbered = lines.filter((l) => markerNumber(l.text) !== null).length;
  const entries: ReferenceEntry[] = [];
  let group: TextLine[] = [];
  let looseNumber: number | null = null;
  const flush = (): void => {
    if (group.length > 0) { entries.push(build(group, looseNumber)); }
    group = [];
    looseNumber = null;
  };

  if (numbered >= 2) {
    let previous: number | null = null;
    for (const line of lines) {
      const strict = markerNumber(line.text);
      const loose: number | null = strict === null ? looseMarkerNumber(line.text, previous) : null;
      const number: number | null = strict ?? loose;
      if (number !== null) { flush(); previous = number; looseNumber = loose; }
      // Text before the first marker is a heading remnant or a page header.
      if (group.length > 0 || number !== null) { group.push(line); }
    }
    flush();
    return entries;
  }

  // Hanging indent: an entry's first line starts at the column's left edge, continuations are indented.
  const baseX = new Map<number, number>();
  for (const l of lines) { baseX.set(l.column, Math.min(baseX.get(l.column) ?? Infinity, l.x)); }
  const indented = lines.filter((l) => l.x > (baseX.get(l.column) ?? 0) + 4).length;
  if (indented >= lines.length * 0.2) {
    for (const line of lines) {
      const atEdge = line.x <= (baseX.get(line.column) ?? 0) + 2;
      if (atEdge) { flush(); }
      group.push(line);
    }
    flush();
    return entries;
  }

  // Block style (ABNT, many theses): entries are flush left and separated by extra vertical space.
  const pitches: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    const d = lines[i - 1]!.y - lines[i]!.y;
    if (lines[i - 1]!.column === lines[i]!.column && d > 0) { pitches.push(d); }
  }
  // The line pitch INSIDE an entry is the small one; a median would land on the gap between entries in a list of short entries.
  const sorted = [...pitches].sort((a, b) => a - b);
  const typical = sorted[Math.floor((sorted.length - 1) * 0.25)] ?? 0;
  const isBreak = (i: number): boolean => {
    const prev = lines[i - 1]!;
    const line = lines[i]!;
    if (prev.column !== line.column) { return true; }
    return typical > 0 && prev.y - line.y > typical * 1.35;
  };
  const gapBreaks = lines.filter((_, i) => i > 0 && lines[i - 1]!.column === lines[i]!.column && isBreak(i)).length;
  if (gapBreaks >= 2) {
    lines.forEach((line, i) => {
      if (i > 0 && isBreak(i)) { flush(); }
      group.push(line);
    });
    flush();
    return entries;
  }

  // Last resort: a line that opens like an author list, right after a line that closed a sentence.
  const startsEntry = (i: number): boolean =>
    AUTHOR_START.test(lines[i]!.text) && (i === 0 || /[.)\]]\s*$/.test(lines[i - 1]!.text));
  if (lines.filter((_, i) => i > 0 && startsEntry(i)).length < 2) { return []; }
  lines.forEach((line, i) => {
    if (i > 0 && startsEntry(i)) { flush(); }
    group.push(line);
  });
  flush();
  return entries;
}

// "Silva, A. B." / "SILVA, Ana" / "Silva AB, Costa R." (Vancouver). The Vancouver form must be followed by another
// capitalised word, or "Revista X, v. 12" (a journal line) would read as an author.
const AUTHOR_START = /^\p{Lu}[\p{L}'’\-]+(?:\s+\p{Lu}[\p{L}'’\-]+){0,2}\s*,\s*\p{Lu}|^\p{Lu}[\p{L}'’\-]+\s+\p{Lu}{1,3}[,.]\s+\p{Lu}/u;

export interface EntryQuery {
  /** Destination y in PDF space; link destinations sit at or slightly above the entry's first line. */
  y: number;
  x?: number | null;
  /** Column split x from `detectColumns`, when the page has two columns. */
  columnSplit?: number | null;
}

/**
 * @usedBy webview/ui/citationResolver.ts
 * @returns the entry whose first line is the nearest at or below the destination, or null if none is plausibly close.
 */
export function entryAtY(entries: readonly ReferenceEntry[], q: EntryQuery): ReferenceEntry | null {
  let pool = [...entries];
  if (q.columnSplit != null && q.x != null) {
    const column = q.x > q.columnSplit ? 1 : 0;
    const inColumn = pool.filter((e) => e.column === column);
    if (inColumn.length > 0) { pool = inColumn; }
  }
  let best: ReferenceEntry | null = null;
  let bestDistance = Infinity;
  for (const e of pool) {
    // Distance from the destination down to the first baseline; tolerate a destination that lands inside the first line.
    const d = q.y - e.yFirst;
    if (d < -e.lineHeight * 0.75) { continue; }
    if (d < bestDistance) { best = e; bestDistance = d; }
  }
  if (!best || bestDistance > best.lineHeight * 4) { return null; }
  return best;
}

export interface AuthorYearQuery {
  surname: string;
  coauthors?: readonly string[];
  /** "2020" or "2020a". */
  years: readonly string[];
}

const MAX_AUTHOR_YEAR_MATCHES = 3;
const CO_AUTHOR_AREA_CHARS = 200;
// Author–year styles (APA, Harvard, ABNT, Chicago) open every entry with the first author's surname, which is also the
// name an in-text citation uses. A surname found later in the entry is a co-author or someone named in the title.
const LEADING_MARKER = /^(?:[[(]?\s*[0-9lI|Oo]{1,3}\s*[\]).]\s*)?/;
const PARTICLES = /^(?:(?:de|da|do|dos|das|del|della|di|du|van|von|der|den|ten|la|le|el|al)\s+)*/;
// Corporate authors are cited by acronym — "(IBGE, 2020)" — while the entry may spell the name out first.
const ACRONYM_AREA_CHARS = 90;

/**
 * Resolves an author–year citation such as "(SILVA; COSTA, 2020)" or "Souza et al. (2019a)" against the reference list.
 * @usedBy webview/ui/citationResolver.ts
 * @returns the matching entries (at most three); several are returned when the list genuinely has several candidates.
 */
export function matchAuthorYear(entries: readonly ReferenceEntry[], q: AuthorYearQuery): ReferenceEntry[] {
  const surname = foldText(q.surname);
  if (surname.length < 2) { return []; }
  const escaped = surname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const opens = new RegExp(`^${escaped}(?:$|[^\\p{L}])`, "u");
  const word = new RegExp(`(?:^|[^\\p{L}])${escaped}(?:$|[^\\p{L}])`, "u");
  const isAcronym = /^\p{Lu}{2,10}$/u.test(q.surname);
  const matches = entries.filter((e) => {
    const folded = foldText(e.text);
    const authors = folded.replace(LEADING_MARKER, "").replace(PARTICLES, "");
    if (!opens.test(authors) && !(isAcronym && word.test(authors.slice(0, ACRONYM_AREA_CHARS)))) { return false; }
    return q.years.some((year) => {
      // "2020" also accepts "2020a"; "2020a" must match exactly.
      const y = year.toLowerCase();
      return new RegExp(/[a-z]$/.test(y) ? `\\b${y}\\b` : `\\b${y}[a-z]?\\b`).test(folded);
    });
  });
  if (matches.length <= 1) { return matches; }
  const co = (q.coauthors ?? []).map(foldText).filter((c) => c.length >= 2);
  const narrowed = co.length > 0
    ? matches.filter((e) => co.every((c) => foldText(e.text).slice(0, CO_AUTHOR_AREA_CHARS).includes(c)))
    : [];
  return (narrowed.length > 0 ? narrowed : matches).slice(0, MAX_AUTHOR_YEAR_MATCHES);
}

/**
 * Lookup for plain-text markers such as "[12]", where there is no link destination to measure against.
 * @usedBy webview/ui/citationResolver.ts
 * @returns the entry whose leading marker carries that number, or null.
 */
export function entryByNumber(entries: readonly ReferenceEntry[], n: number): ReferenceEntry | null {
  return entries.find((e) => e.number === n) ?? null;
}
