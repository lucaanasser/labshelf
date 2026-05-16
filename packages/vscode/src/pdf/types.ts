/**
 * Module: PDF Import Types
 * Responsibility: Shared interfaces for the PDF import pipeline
 */

export interface ParsedPdfImport {
  title: string;
  citeKey: string;
  year?: number;
  authors: string[];
  // Bibliographic fields returned by CrossRef / arXiv
  journal?: string;
  publisher?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  doi?: string;
  url?: string;
  issn?: string;
  language?: string;
  summary?: string;
}

export interface ResolvedMetadata {
  title?: string | undefined;
  authors?: string[] | undefined;
  year?: number | undefined;
  journal?: string | undefined;
  publisher?: string | undefined;
  volume?: string | undefined;
  issue?: string | undefined;
  pages?: string | undefined;
  doi?: string | undefined;
  url?: string | undefined;
  issn?: string | undefined;
  language?: string | undefined;
  summary?: string | undefined;
}

export interface DetectedIdentifier {
  type: "doi" | "arxiv";
  value: string;
}

// A run of page-1 text sharing the same font size, in reading order. Used to
// recover the title (largest font near the top) and the author line below it.
export interface TextBlock {
  size: number;
  text: string;
}
