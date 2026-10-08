/**
 * Formats a quoted passage together with a citation of the paper it came from, in the style chosen by `labshelf.reader.citationStyle`.
 *
 * @depends pdf-viewer/shared/protocol.ts (types only), @labshelf/core (types only)
 * @dependents pdf-viewer/PdfViewerPanel.ts, pdf-viewer/shared/annotationsMarkdown.ts
 */
import type { PaperRecord } from "@labshelf/core";
import type { CitationStyle } from "./protocol.js";

export type CitablePaper = Pick<PaperRecord, "citeKey" | "title" | "authors" | "year">;

/**
 * Text-layer selections carry hard line breaks and hyphenation from the PDF layout; a quote should read as running prose.
 * @usedBy formatQuoteWithCitation, pdf-viewer/shared/annotationsMarkdown.ts
 * @returns the quote with hyphenation joined and whitespace collapsed.
 */
export function cleanQuote(text: string): string {
  return text
    .replace(/(\p{L})-\s*\n\s*(\p{Ll})/gu, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
}

function surname(author: string): string {
  const a = author.trim();
  if (a.includes(",")) { return a.slice(0, a.indexOf(",")).trim(); }
  const parts = a.split(/\s+/);
  return parts[parts.length - 1] ?? a;
}

/**
 * Short author-year label such as "Silva et al., 2021".
 * @usedBy formatQuoteWithCitation, pdf-viewer/shared/annotationsMarkdown.ts
 * @returns the label; falls back to the cite key when no author is known.
 */
export function authorYearLabel(paper: CitablePaper): string {
  const authors = (paper.authors ?? []).filter((a) => a.trim().length > 0);
  let who: string;
  if (authors.length === 0) { who = paper.citeKey; }
  else if (authors.length === 1) { who = surname(authors[0]!); }
  else if (authors.length === 2) { who = `${surname(authors[0]!)} & ${surname(authors[1]!)}`; }
  else { who = `${surname(authors[0]!)} et al.`; }
  return paper.year ? `${who}, ${paper.year}` : who;
}

/**
 * Builds the clipboard text for "copy with citation".
 * @usedBy pdf-viewer/PdfViewerPanel.ts
 * @returns the quote plus its citation in the requested style.
 */
export function formatQuoteWithCitation(
  text: string,
  paper: CitablePaper,
  pageNumber: number,
  style: CitationStyle,
): string {
  const quote = cleanQuote(text);
  switch (style) {
    case "pandoc":
      return `> ${quote}\n\n[@${paper.citeKey}, p. ${pageNumber}]`;
    case "latex":
      return `\`\`${quote}'' \\cite[p.~${pageNumber}]{${paper.citeKey}}`;
    case "author-year":
      return `"${quote}" (${authorYearLabel(paper)}, p. ${pageNumber})`;
    case "citekey":
      return `${quote} @${paper.citeKey}`;
  }
}
