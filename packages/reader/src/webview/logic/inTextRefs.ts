/**
 * Finds the things a reader hovers in running text — numeric citations, author–year citations and figure/table/equation
 * references — without relying on PDF link annotations. Scanned papers made searchable by OCR have none, and the OCR
 * text arrives one word per text run, so detection works on a whole visual line re-joined from its runs.
 *
 * @depends none
 * @dependents webview/ui/hoverPreview.ts
 */

export type FloatKind = "figure" | "table" | "equation";

export type InTextRef =
  | { kind: "numeric"; start: number; end: number; numbers: number[] }
  | { kind: "authorYear"; start: number; end: number; surname: string; coauthors: string[]; years: string[] }
  | { kind: "float"; start: number; end: number; floatKind: FloatKind; label: string };

/* ── re-joining a visual line ─────────────────────────────────── */

export interface LinePart {
  text: string;
  left: number;
  right: number;
  height: number;
}

export interface JoinedLine {
  text: string;
  /** Offset of each part inside `text`. */
  starts: number[];
}

/**
 * Concatenates the text runs of one visual line (already sorted left to right). A space is inserted only across a real
 * horizontal gap, so a born-digital run split mid-word stays one word while OCR's per-word runs become a sentence again.
 * @usedBy webview/ui/hoverPreview.ts
 * @returns the joined text and where each part starts in it.
 */
export function joinLineParts(parts: readonly LinePart[]): JoinedLine {
  let text = "";
  const starts: number[] = [];
  let prev: LinePart | null = null;
  for (const part of parts) {
    if (prev) {
      const gap = part.left - prev.right;
      const needsSpace = gap > Math.max(prev.height, part.height) * 0.12 && !/\s$/.test(text) && !/^\s/.test(part.text);
      if (needsSpace) { text += " "; }
    }
    starts.push(text.length);
    text += part.text;
    prev = part;
  }
  return { text, starts };
}

/* ── numeric citations ────────────────────────────────────────── */

// OCR routinely reads 1 as l / I / | and 0 as O / o inside a bracketed number.
const NUM = "[0-9lI|Oo]{1,3}";
const BRACKET = new RegExp(`\\[\\s*(${NUM}(?:\\s*[-–—,;]\\s*${NUM})*)\\s*\\]`, "g");
const MAX_RANGE = 50;

function ocrNumber(token: string): number | null {
  const t = token.trim();
  if (!/^[0-9lI|Oo]{1,3}$/.test(t)) { return null; }
  // A token with no real digit is only trusted when it is a lone "1" look-alike, e.g. "[l]".
  if (!/\d/.test(t) && !/^[lI|]$/.test(t)) { return null; }
  const n = Number(t.replace(/[lI|]/g, "1").replace(/[Oo]/g, "0"));
  return Number.isInteger(n) && n > 0 ? n : null;
}

function expandNumbers(body: string): number[] {
  const out: number[] = [];
  for (const part of body.split(/[,;]/)) {
    const range = part.split(/[-–—]/);
    if (range.length === 2) {
      const a = ocrNumber(range[0]!);
      const b = ocrNumber(range[1]!);
      if (a !== null && b !== null && b >= a && b - a <= MAX_RANGE) {
        for (let n = a; n <= b; n++) { out.push(n); }
      }
      continue;
    }
    const n = ocrNumber(part);
    if (n !== null) { out.push(n); }
  }
  return [...new Set(out)];
}

/* ── author–year citations ────────────────────────────────────── */

const YEAR = "(?:1[5-9]\\d{2}|20\\d{2})[a-z]?";
const YEAR_RE = new RegExp(`\\b${YEAR}\\b`, "g");
const NAME = "\\p{Lu}[\\p{L}'’\\-]+";
const NAME_RE = new RegExp(NAME, "gu");
const PAREN = /\(([^()]{3,200})\)/g;
// "Silva (2020)", "Silva et al. (2020, 2021)", "Silva and Costa (2020)", "Silva e Costa (2020, p. 12)"
const NARRATIVE = new RegExp(
  `(${NAME})((?:\\s+(?:et\\s+al\\.?|e\\s+cols?\\.?|and\\s+${NAME}|&\\s+${NAME}|e\\s+${NAME}|y\\s+${NAME}|und\\s+${NAME}))?)` +
  `\\s*\\((${YEAR}(?:\\s*[,;e&]\\s*${YEAR})*)(?:\\s*[,:]\\s*[^()]{0,24})?\\)`,
  "gu",
);

// Capitalised words that open a parenthetical but are not authors.
const NOT_AUTHORS = new Set([
  "fig", "figs", "figure", "figures", "figura", "figuras", "table", "tables", "tabela", "tabelas", "tab", "quadro",
  "grafico", "chart", "eq", "eqs", "equation", "equations", "equacao", "section", "sections", "secao", "chapter", "capitulo",
  "appendix", "apendice", "anexo", "see", "ver", "veja", "in", "em", "from", "de", "and", "the", "cf", "apud", "ibid",
  "january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december",
  "janeiro", "fevereiro", "marco", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
  "copyright", "received", "accepted", "published", "vol", "volume", "no", "pp",
]);

/** Lower-cased, accent-free form used to compare names: OCR with English language data usually drops diacritics. */
export function foldText(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function authorNames(chunk: string): string[] {
  const names: string[] = [];
  for (const m of chunk.matchAll(NAME_RE)) {
    const folded = foldText(m[0]);
    if (folded.length >= 2 && !NOT_AUTHORS.has(folded)) { names.push(m[0]); }
  }
  return names;
}

function parentheticalRefs(text: string): InTextRef[] {
  const refs: InTextRef[] = [];
  for (const m of text.matchAll(PAREN)) {
    const inner = m[1]!;
    if (!YEAR_RE.test(inner)) { YEAR_RE.lastIndex = 0; continue; }
    YEAR_RE.lastIndex = 0;
    const base = m.index + 1;
    // ";" separates citations — except in ABNT, where it separates the authors of ONE citation: "(SILVA; COSTA, 2020)".
    // So a piece with no year is glued to the following pieces until a year closes the citation.
    let cursor = 0;
    let open: { start: number; text: string } | null = null;
    for (const piece of inner.split(/(;|\bapud\b)/)) {
      const start = cursor;
      cursor += piece.length;
      // Separators are kept verbatim inside a pending chunk so character offsets stay exact ("apud" is lower case, never a name).
      if (piece === ";" || piece === "apud") { if (open) { open.text += piece; } continue; }
      const chunk: { start: number; text: string } = open ? { start: open.start, text: open.text + piece } : { start, text: piece };
      const years = [...chunk.text.matchAll(YEAR_RE)].map((y) => y[0]);
      if (years.length === 0) { open = chunk; continue; }
      open = null;
      // Authors are what precedes the first year.
      const names = authorNames(chunk.text.slice(0, chunk.text.search(YEAR_RE)));
      YEAR_RE.lastIndex = 0;
      if (names.length === 0) { continue; }
      const lead = chunk.text.length - chunk.text.trimStart().length;
      refs.push({
        kind: "authorYear",
        start: base + chunk.start + lead,
        end: base + chunk.start + chunk.text.trimEnd().length,
        surname: names[0]!,
        coauthors: names.slice(1),
        years,
      });
    }
  }
  return refs;
}

function narrativeRefs(text: string): InTextRef[] {
  const refs: InTextRef[] = [];
  for (const m of text.matchAll(NARRATIVE)) {
    const surname = m[1]!;
    if (NOT_AUTHORS.has(foldText(surname))) { continue; }
    const years = [...m[3]!.matchAll(YEAR_RE)].map((y) => y[0]);
    if (years.length === 0) { continue; }
    refs.push({
      kind: "authorYear",
      start: m.index,
      end: m.index + m[0].length,
      surname,
      coauthors: authorNames(m[2] ?? ""),
      years,
    });
  }
  return refs;
}

/* ── figure / table / equation references ─────────────────────── */

/** A float's number as printed: "3", "3a", or numbered within its section ("1.1", "6.2b"). Shared with captions.ts so both sides read the same label. */
export const FLOAT_LABEL = "\\d{1,3}(?:\\.\\d{1,3})*[a-z]?";
/** "Fig", "Figure", "Figura" — and what OCR makes of a small-caps "FIG.": "F1G", "FlG", "Fi1G". Shared with captions.ts. */
export const FIGURE_WORD = "F[i1l|]{1,2}g(?:ure|ura)?s?";

// Case-insensitive: Portuguese and Spanish running text writes "figura 3" / "tabela 2" in lower case.
const FLOAT = new RegExp(
  `\\b(${FIGURE_WORD}|Tab(?:le|ela|la)?s?|Quadros?|Cuadros?|Gr[áa]ficos?|Charts?|Eq(?:uation|ua[çc][ãa]o|ua[çc][õo]es|uaci[óo]n)?s?)\\s*\\.?\\s*\\(?\\s*(${FLOAT_LABEL})\\s*\\)?`,
  "giu",
);

/**
 * @usedBy findInTextRefs, webview/logic/captions.ts
 * @returns the kind of float a label word ("Fig.", "Tabela", "Eq") denotes.
 */
export function floatKindOf(word: string): FloatKind {
  const w = foldText(word);
  if (w.startsWith("tab") || w.startsWith("quadro") || w.startsWith("cuadro")) { return "table"; }
  if (w.startsWith("eq")) { return "equation"; }
  return "figure";
}

/* ── public API ───────────────────────────────────────────────── */

/**
 * @usedBy webview/ui/hoverPreview.ts
 * @returns every reference found in a line of text, with its character range.
 */
export function findInTextRefs(text: string): InTextRef[] {
  const refs: InTextRef[] = [];
  for (const m of text.matchAll(BRACKET)) {
    const numbers = expandNumbers(m[1] ?? "");
    if (numbers.length > 0) { refs.push({ kind: "numeric", start: m.index, end: m.index + m[0].length, numbers }); }
  }
  for (const m of text.matchAll(FLOAT)) {
    refs.push({ kind: "float", start: m.index, end: m.index + m[0].length, floatKind: floatKindOf(m[1]!), label: m[2]!.toLowerCase() });
  }
  refs.push(...narrativeRefs(text), ...parentheticalRefs(text));
  return refs;
}

/**
 * @usedBy webview/ui/hoverPreview.ts
 * @returns the narrowest reference covering a character offset, or null.
 */
export function refAtOffset(refs: readonly InTextRef[], offset: number): InTextRef | null {
  let best: InTextRef | null = null;
  for (const ref of refs) {
    if (offset < ref.start || offset >= ref.end) { continue; }
    if (!best || ref.end - ref.start < best.end - best.start) { best = ref; }
  }
  return best;
}
