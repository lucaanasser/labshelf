/**
 * Finds every publication identifier a PDF might carry — DOI, arXiv, PubMed,
 * PMC and ISBN — in its metadata, link annotations and text. Returns ranked
 * candidates rather than one guess, because text recovered by OCR or from a
 * damaged font encoding routinely contains near-misses that only an online
 * lookup can tell apart.
 *
 * @depends io/pdf/types.ts
 * @dependents io/pdf/parser.ts, io/pdf/resolver.ts, io/pdf/extractor.ts
 */
import type { DetectedIdentifier } from "./types.js";

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

const DOI_PATTERN = /10\.\d{4,9}\/[-._;()/:a-z0-9<>+]+/gi;
const ARXIV_PATTERN = /(?:arxiv[.:\s/]*(?:org\/(?:abs|pdf)\/)?)(\d{4}\.\d{4,5})(?:v\d+)?/gi;
const ARXIV_LEGACY_PATTERN = /arxiv[.:\s/]*([a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?/gi;
const PMID_PATTERN = /\bPMID[:\s]*(\d{7,8})\b/gi;
const PMCID_PATTERN = /\b(PMC\d{6,8})\b/gi;
const ISBN_PATTERN = /\bISBN(?:-1[03])?[:\s]*((?:97[89][-\s]?)?(?:\d[-\s]?){9}[\dXx])\b/gi;

/**
 * Collects all identifiers present in a PDF, most trustworthy first.
 * @usedBy io/pdf/parser.ts
 * @returns Ranked, deduplicated identifier candidates.
 */
export function detectIdentifiers(
  pdfInfo: Record<string, unknown>,
  text: string,
  linkUrls: string[] = [],
): DetectedIdentifier[] {
  const found: DetectedIdentifier[] = [];
  const seen = new Set<string>();

  const add = (type: DetectedIdentifier["type"], value: string | undefined): void => {
    if (!value) {
      return;
    }
    const key = `${type}:${value.toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      found.push({ type, value });
    }
  };

  // Ranked by how directly the source states the identifier: an explicit
  // metadata field, then a link target, then anything spotted in the text.
  const metaText = [
    asString(pdfInfo["DOI"]),
    asString(pdfInfo["Subject"]),
    asString(pdfInfo["Keywords"]),
    asString(pdfInfo["WPS-ARTICLEDOI"]),
  ]
    .filter(Boolean)
    .join(" ");
  const urlText = linkUrls.join(" ");

  for (const source of [metaText, urlText, text]) {
    if (!source) {
      continue;
    }
    for (const doi of matchAll(source, DOI_PATTERN)) {
      add("doi", stripTrailingPunctuation(doi));
    }
    for (const arxiv of matchAll(source, ARXIV_PATTERN, 1)) {
      add("arxiv", arxiv);
    }
    for (const arxiv of matchAll(source, ARXIV_LEGACY_PATTERN, 1)) {
      add("arxiv", arxiv);
    }
    for (const pmid of matchAll(source, PMID_PATTERN, 1)) {
      add("pmid", pmid);
    }
    for (const pmcid of matchAll(source, PMCID_PATTERN, 1)) {
      add("pmcid", pmcid.toUpperCase());
    }
    for (const isbn of matchAll(source, ISBN_PATTERN, 1)) {
      add("isbn", isbn.replace(/[-\s]/g, ""));
    }
  }

  // Text extraction can split a DOI across items ("10.1038/ nature12373").
  if (!found.some((entry) => entry.type === "doi")) {
    const glued = text.replace(/(10\.\d{4,9}\s*\/)\s*/gi, (_m, prefix: string) => prefix.replace(/\s+/g, ""));
    for (const doi of matchAll(glued, DOI_PATTERN)) {
      add("doi", stripTrailingPunctuation(doi));
    }
  }

  return rank(found, text);
}

/**
 * Expands a DOI into the forms worth trying against a registry. Publishers mint
 * per-component DOIs (`10.7554/eLife.28383.001` for an abstract), so the parent
 * DOI must also be attempted to reach the article record itself.
 * @usedBy io/pdf/resolver.ts
 * @returns The DOI plus any parent form, in the order they should be tried.
 */
export function doiVariants(doi: string): string[] {
  const variants = [doi];
  const parent = doi.replace(/\.\d{3}$/, "");
  if (parent !== doi) {
    variants.push(parent);
  }
  return variants;
}

// Identifiers stated next to an explicit label are far more likely to belong to
// this paper than one scraped out of the bibliography.
function rank(found: DetectedIdentifier[], text: string): DetectedIdentifier[] {
  const priority: Record<DetectedIdentifier["type"], number> = {
    doi: 0,
    arxiv: 1,
    pmid: 2,
    pmcid: 3,
    isbn: 4,
  };

  return [...found].sort((a, b) => {
    const labelled = Number(isLabelled(b, text)) - Number(isLabelled(a, text));
    return labelled !== 0 ? labelled : priority[a.type] - priority[b.type];
  });
}

function isLabelled(identifier: DetectedIdentifier, text: string): boolean {
  const index = text.indexOf(identifier.value);
  if (index < 0) {
    return false;
  }
  return /\b(doi|doi\.org|arxiv|pmid|pmc|isbn|cite this|citation)\b[\s:/]*$/i.test(
    text.slice(Math.max(0, index - 24), index),
  );
}

function matchAll(text: string, pattern: RegExp, group = 0): string[] {
  // Fresh regex per call: the module-level patterns are global and stateful.
  const local = new RegExp(pattern.source, pattern.flags);
  return [...text.matchAll(local)].map((match) => match[group] ?? "").filter(Boolean);
}

function stripTrailingPunctuation(value: string): string {
  return value.replace(/[)\].,;:]+$/g, "");
}
