/**
 * Formats a paper as a ready-to-paste reference in the common styles (APA 7, MLA 9, Chicago author-date) and as an
 * in-text marker, from whatever bibliographic fields the record has. Missing fields are left out rather than guessed.
 *
 * @depends @labshelf/core (types only)
 * @dependents ui/list/listWebviewPanel.ts
 */
import type { PaperRecord } from '@labshelf/core';

export interface CitationSet {
  apa: string;
  mla: string;
  chicago: string;
  /** Short in-text form, e.g. "Vaswani et al., 2017". */
  inText: string;
}

interface Name {
  given: string;
  family: string;
}

/**
 * Builds every citation style for one paper.
 * @usedBy ui/list/listWebviewPanel.ts
 * @returns the formatted references
 */
export function formatCitations(paper: PaperRecord): CitationSet {
  return { apa: apa(paper), mla: mla(paper), chicago: chicago(paper), inText: inText(paper) };
}

// Accepts "Given Family" and "Family, Given"; a single word is a family name.
export function splitName(raw: string): Name {
  const name = raw.trim().replace(/\s+/g, ' ');
  const comma = name.indexOf(',');
  if (comma !== -1) {
    return { family: name.slice(0, comma).trim(), given: name.slice(comma + 1).trim() };
  }
  const parts = name.split(' ');
  // Keep particles with the family name: "Ludwig van Beethoven" → "van Beethoven".
  let at = parts.length - 1;
  while (at > 1 && PARTICLES.has(parts[at - 1]!.toLowerCase())) { at--; }
  return { given: parts.slice(0, at).join(' '), family: parts.slice(at).join(' ') };
}

const PARTICLES = new Set(['van', 'von', 'der', 'den', 'de', 'del', 'della', 'da', 'di', 'du', 'la', 'le', 'dos', 'das']);

function initials(given: string): string {
  return given
    .split(/[\s.]+/)
    .filter(Boolean)
    .map((part) => part.split('-').map((piece) => piece.charAt(0).toUpperCase() + '.').join('-'))
    .join(' ');
}

function names(paper: PaperRecord): Name[] {
  return (paper.authors ?? []).filter((a) => a.trim()).map(splitName);
}

function sentence(text: string): string {
  const trimmed = text.trim();
  return /[.?!]$/.test(trimmed) ? trimmed : trimmed + '.';
}

function doiUrl(paper: PaperRecord): string {
  if (paper.doi) { return 'https://doi.org/' + paper.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, ''); }
  return paper.url ?? '';
}

function joinList(items: string[], conj: string, serialComma: boolean): string {
  if (items.length <= 1) { return items.join(''); }
  if (items.length === 2) { return items[0] + ' ' + conj + ' ' + items[1]; }
  return items.slice(0, -1).join(', ') + (serialComma ? ', ' : ' ') + conj + ' ' + items[items.length - 1];
}

function apa(paper: PaperRecord): string {
  const list = names(paper).map((n) => (n.given ? n.family + ', ' + initials(n.given) : n.family));
  // APA 7: up to 20 authors, "&" before the last; beyond that, the first 19, an ellipsis, and the last.
  const authors = list.length > 20
    ? list.slice(0, 19).join(', ') + ', … ' + list[list.length - 1]
    : list.length > 1 ? list.slice(0, -1).join(', ') + ', & ' + list[list.length - 1] : list.join('');
  const parts: string[] = [];
  if (authors) { parts.push(sentence(authors)); }
  parts.push('(' + (paper.year ?? 'n.d.') + ').');
  parts.push(sentence(paper.title));
  const venue = paper.journal ?? paper.publisher;
  if (venue) {
    let source = venue;
    if (paper.volume) { source += ', ' + paper.volume + (paper.issue ? '(' + paper.issue + ')' : ''); }
    if (paper.pages) { source += ', ' + paper.pages.replace(/-+/g, '–'); }
    parts.push(source + '.');
  }
  const link = doiUrl(paper);
  if (link) { parts.push(link); }
  return parts.join(' ');
}

function mla(paper: PaperRecord): string {
  const list = names(paper);
  let authors = '';
  if (list.length === 1) {
    authors = list[0]!.given ? list[0]!.family + ', ' + list[0]!.given : list[0]!.family;
  } else if (list.length === 2) {
    authors = list[0]!.family + ', ' + list[0]!.given + ', and ' + [list[1]!.given, list[1]!.family].filter(Boolean).join(' ');
  } else if (list.length > 2) {
    authors = list[0]!.family + ', ' + list[0]!.given + ', et al';
  }
  const parts: string[] = [];
  if (authors) { parts.push(sentence(authors)); }
  parts.push('“' + sentence(paper.title) + '”');
  const container: string[] = [];
  const venue = paper.journal ?? paper.publisher;
  if (venue) { container.push(venue); }
  if (paper.volume) { container.push('vol. ' + paper.volume); }
  if (paper.issue) { container.push('no. ' + paper.issue); }
  if (paper.year) { container.push(String(paper.year)); }
  if (paper.pages) { container.push('pp. ' + paper.pages.replace(/-+/g, '–')); }
  if (container.length) { parts.push(container.join(', ') + '.'); }
  if (paper.doi) { parts.push(sentence('https://doi.org/' + paper.doi)); }
  return parts.join(' ');
}

function chicago(paper: PaperRecord): string {
  const list = names(paper);
  const formatted = list.map((n, i) => {
    if (!n.given) { return n.family; }
    return i === 0 ? n.family + ', ' + n.given : n.given + ' ' + n.family;
  });
  // Chicago 17 author-date: list up to ten authors; with more, the first seven and "et al."
  const authors = formatted.length > 10 ? formatted.slice(0, 7).join(', ') + ', et al' : joinList(formatted, 'and', true);
  const parts: string[] = [];
  if (authors) { parts.push(sentence(authors)); }
  parts.push((paper.year ?? 'n.d.') + '.');
  parts.push('“' + sentence(paper.title) + '”');
  const venue = paper.journal ?? paper.publisher;
  if (venue) {
    let source = venue;
    if (paper.volume) { source += ' ' + paper.volume + (paper.issue ? ' (' + paper.issue + ')' : ''); }
    if (paper.pages) { source += ': ' + paper.pages.replace(/-+/g, '–'); }
    parts.push(source + '.');
  }
  const link = doiUrl(paper);
  if (link) { parts.push(sentence(link)); }
  return parts.join(' ');
}

function inText(paper: PaperRecord): string {
  const list = names(paper);
  const year = paper.year ? String(paper.year) : 'n.d.';
  if (list.length === 0) { return paper.title + ', ' + year; }
  if (list.length === 1) { return list[0]!.family + ', ' + year; }
  if (list.length === 2) { return list[0]!.family + ' & ' + list[1]!.family + ', ' + year; }
  return list[0]!.family + ' et al., ' + year;
}
