/**
 * The query language shared by the list filter (f), the library search (s) and `labshelf search`:
 *
 *   attention transformer        every word must match (title, authors, venue, abstract, tags, note, ids…)
 *   "exact phrase"               quoted phrase
 *   -survey                      exclude a word
 *   tag:nlp  #nlp                has the tag (prefix match)
 *   status:reading  is:unread    reading status (u/r/d shortcuts accepted)
 *   year:2017  year:2015..2020  year:>2018  year:<2000
 *   author:vaswani  au:vaswani   author match
 *   has:pdf  no:pdf  has:note  has:doi  has:tags
 *
 * Matching is case- and accent-insensitive. Results are ranked: title hits first, then authors, then the rest.
 *
 * @depends tui/text (fold), library/libraryScanner
 * @dependents library/libraryStore, ui, cli
 */
import type { PaperRecord, PaperStatus } from "@labshelf/core";

import { fold } from "../tui/text.js";

export interface ParsedQuery {
  terms: string[];
  excluded: string[];
  tags: string[];
  authors: string[];
  statuses: PaperStatus[];
  yearMin?: number;
  yearMax?: number;
  has: string[];
  missing: string[];
}

const HAS_KEYS = new Set(["pdf", "note", "notes", "doi", "tag", "tags", "abstract", "summary"]);

const STATUS_ALIASES: Record<string, PaperStatus> = {
  u: "unread", unread: "unread", new: "unread",
  r: "reading", reading: "reading",
  d: "done", done: "done", read: "done",
};

/**
 * Splits a query into words, keeping quoted phrases together.
 * @usedBy parseQuery
 * @returns the tokens
 */
export function tokenize(query: string): string[] {
  const tokens: string[] = [];
  const re = /(-?[\w:#.<>=-]*?)"([^"]*)"?|(\S+)/gu;
  let match: RegExpExecArray | null;
  while ((match = re.exec(query)) !== null) {
    if (match[3] !== undefined) {
      tokens.push(match[3]);
    } else {
      tokens.push((match[1] ?? "") + (match[2] ?? ""));
    }
  }
  return tokens.filter((t) => t.length > 0);
}

function parseYear(value: string, query: ParsedQuery): boolean {
  const range = /^(\d{4})?\.\.(\d{4})?$/.exec(value);
  if (range) {
    if (range[1]) { query.yearMin = Number(range[1]); }
    if (range[2]) { query.yearMax = Number(range[2]); }
    return true;
  }
  const cmp = /^([<>]=?)(\d{4})$/.exec(value);
  if (cmp) {
    const year = Number(cmp[2]);
    if (cmp[1] === ">") { query.yearMin = year + 1; }
    if (cmp[1] === ">=") { query.yearMin = year; }
    if (cmp[1] === "<") { query.yearMax = year - 1; }
    if (cmp[1] === "<=") { query.yearMax = year; }
    return true;
  }
  if (/^\d{4}$/.test(value)) {
    query.yearMin = Number(value);
    query.yearMax = Number(value);
    return true;
  }
  return false;
}

/**
 * Parses the query language.
 * @usedBy matchPaper callers (libraryStore, cli)
 * @returns the structured query
 */
export function parseQuery(query: string): ParsedQuery {
  const parsed: ParsedQuery = { terms: [], excluded: [], tags: [], authors: [], statuses: [], has: [], missing: [] };
  for (const token of tokenize(query)) {
    if (token.startsWith("#") && token.length > 1) {
      parsed.tags.push(fold(token.slice(1)));
      continue;
    }
    const colon = token.indexOf(":");
    if (colon > 0) {
      const key = token.slice(0, colon).toLowerCase();
      const value = token.slice(colon + 1);
      if (value) {
        if (key === "tag" || key === "t") { parsed.tags.push(fold(value)); continue; }
        if (key === "author" || key === "au" || key === "a") { parsed.authors.push(fold(value)); continue; }
        if ((key === "status" || key === "is" || key === "s") && STATUS_ALIASES[value.toLowerCase()]) {
          parsed.statuses.push(STATUS_ALIASES[value.toLowerCase()]!);
          continue;
        }
        if ((key === "year" || key === "y") && parseYear(value, parsed)) { continue; }
        if ((key === "has" || key === "no") && HAS_KEYS.has(value.toLowerCase())) {
          (key === "has" ? parsed.has : parsed.missing).push(value.toLowerCase());
          continue;
        }
      }
    }
    if (token.startsWith("-") && token.length > 1) {
      parsed.excluded.push(fold(token.slice(1)));
      continue;
    }
    parsed.terms.push(fold(token));
  }
  return parsed;
}

/**
 * @returns true when the query has no conditions at all
 */
export function isEmptyQuery(q: ParsedQuery): boolean {
  return !q.terms.length && !q.excluded.length && !q.tags.length && !q.authors.length && !q.statuses.length
    && q.yearMin === undefined && q.yearMax === undefined && !q.has.length && !q.missing.length;
}

/** Folded text fields of a paper, computed once per paper and cached by the store. */
export interface SearchDoc {
  title: string;
  authors: string;
  rest: string;
  tags: string[];
}

/**
 * Builds the folded search document of a paper; `extra` adds annotation text.
 * @usedBy library/libraryStore
 * @returns the document
 */
export function searchDoc(record: PaperRecord, extra = ""): SearchDoc {
  const rest = [
    record.id, record.citeKey, record.journal, record.publisher, record.doi, record.url, record.summary, record.note,
    record.year?.toString(), ...(record.keywords ?? []), ...(record.tags ?? []), extra,
  ].filter(Boolean).join("\n");
  return {
    title: fold(record.title),
    authors: fold((record.authors ?? []).join("; ")),
    rest: fold(rest),
    tags: (record.tags ?? []).map(fold),
  };
}

function has(record: PaperRecord, what: string): boolean {
  switch (what) {
    case "pdf": return record.hasPdf !== false;
    case "note": case "notes": return Boolean(record.note?.trim());
    case "doi": return Boolean(record.doi);
    case "tag": case "tags": return Boolean(record.tags?.length);
    case "abstract": case "summary": return Boolean(record.summary?.trim());
    default: return true;
  }
}

/**
 * Scores a paper against a query.
 * @usedBy library/libraryStore, cli
 * @returns 0 when it does not match, otherwise a rank (higher is better)
 */
export function matchPaper(record: PaperRecord, doc: SearchDoc, q: ParsedQuery): number {
  if (q.statuses.length && !q.statuses.includes(record.status)) { return 0; }
  if (q.yearMin !== undefined && (record.year === undefined || record.year < q.yearMin)) { return 0; }
  if (q.yearMax !== undefined && (record.year === undefined || record.year > q.yearMax)) { return 0; }
  if (q.tags.some((tag) => !doc.tags.some((t) => t.startsWith(tag)))) { return 0; }
  if (q.authors.some((a) => !doc.authors.includes(a))) { return 0; }
  if (q.has.some((h) => !has(record, h))) { return 0; }
  if (q.missing.some((m) => has(record, m))) { return 0; }
  const all = `${doc.title}\n${doc.authors}\n${doc.rest}`;
  if (q.excluded.some((term) => all.includes(term))) { return 0; }
  let score = 1;
  for (const term of q.terms) {
    if (doc.title.includes(term)) {
      score += doc.title.startsWith(term) ? 12 : 10;
    } else if (doc.authors.includes(term)) {
      score += 6;
    } else if (doc.rest.includes(term)) {
      score += 2;
    } else {
      return 0;
    }
  }
  return score;
}
