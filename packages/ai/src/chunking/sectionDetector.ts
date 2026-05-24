/**
 * Detects section headings in extracted PDF text using heading regexes that
 * cover the most common academic paper conventions (numbered sections,
 * Introduction / Methods / Results / Discussion / References anchors).
 *
 * No model required. Returns headings with their offset in the joined text.
 *
 * @depends ../types/chunk.ts
 * @dependents chunking/sectionChunker.ts
 */
import type { PaperSection } from "../types/chunk.js";

const NUMBERED = /^\s{0,4}(\d{1,2}(?:\.\d{1,2}){0,2})\s+([A-Z][^\n]{2,80})$/gm;
const NAMED = /^\s{0,4}(Abstract|Introduction|Background|Related Work|Methods?|Methodology|Approach|Experiments?|Results?|Evaluation|Discussion|Conclusions?|References|Acknowledgements?|Limitations?)\s*$/gim;

interface HeadingMatch {
  heading: string;
  offset: number;
  page: number;
}

/**
 * Locates section headings in the merged text of a paper.
 *
 * @usedBy chunking/sectionChunker
 * @returns Sorted, non-overlapping list of sections with their text spans.
 */
export function detectSections(
  pages: { page: number; text: string }[],
): PaperSection[] {
  const merged = mergePages(pages);
  const matches = collectMatches(merged.text);
  matches.sort((a, b) => a.offset - b.offset);
  return materializeSections(matches, merged);
}

function mergePages(pages: { page: number; text: string }[]): {
  text: string;
  pageBreaks: { offset: number; page: number }[];
} {
  let text = "";
  const pageBreaks: { offset: number; page: number }[] = [];
  for (const p of pages) {
    pageBreaks.push({ offset: text.length, page: p.page });
    text += p.text + "\n";
  }
  return { text, pageBreaks };
}

function collectMatches(text: string): HeadingMatch[] {
  const found: HeadingMatch[] = [];
  for (const m of text.matchAll(NUMBERED)) {
    if (m.index === undefined) continue;
    found.push({ heading: `${m[1]} ${m[2]}`.trim(), offset: m.index, page: 0 });
  }
  for (const m of text.matchAll(NAMED)) {
    if (m.index === undefined) continue;
    found.push({ heading: (m[1] ?? "").trim(), offset: m.index, page: 0 });
  }
  return dedupeByOffset(found);
}

function dedupeByOffset(items: HeadingMatch[]): HeadingMatch[] {
  const seen = new Set<number>();
  return items.filter((it) => {
    if (seen.has(it.offset)) return false;
    seen.add(it.offset);
    return true;
  });
}

function materializeSections(
  matches: HeadingMatch[],
  merged: { text: string; pageBreaks: { offset: number; page: number }[] },
): PaperSection[] {
  if (matches.length === 0) return [];
  const sections: PaperSection[] = [];
  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i];
    if (!cur) continue;
    const next = matches[i + 1];
    const start = cur.offset;
    const end = next ? next.offset : merged.text.length;
    sections.push({
      heading: cur.heading,
      page: pageForOffset(start, merged.pageBreaks),
      startOffset: start,
      endOffset: end,
      text: merged.text.slice(start, end).trim(),
    });
  }
  return sections;
}

function pageForOffset(
  offset: number,
  pageBreaks: { offset: number; page: number }[],
): number {
  let current = 1;
  for (const br of pageBreaks) {
    if (br.offset <= offset) current = br.page;
    else break;
  }
  return current;
}
