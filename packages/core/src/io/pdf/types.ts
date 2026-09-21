/**
 * Shared type definitions for the PDF import pipeline (identifiers, parsed metadata, resolved metadata).
 *
 * @depends none
 * @dependents io/pdf/parser.ts, io/pdf/extractor.ts, io/pdf/textExtraction.ts, io/pdf/resolver.ts
 */

export interface ParsedPdfImport {
  title: string;
  citeKey: string;
  confidence?: MetadataConfidence;
  // How the winning record was obtained, for logs and the import report.
  source?: string;
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
  keywords?: string[];
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
  keywords?: string[] | undefined;
}

export type IdentifierType = "doi" | "arxiv" | "pmid" | "pmcid" | "isbn";

export interface DetectedIdentifier {
  type: IdentifierType;
  value: string;
}

/**
 * How much the parser trusts the record it produced.
 * - `high`: confirmed against a registry via an identifier printed in the PDF.
 * - `medium`: matched online by text, or taken from an embedded XMP packet.
 * - `low`: inferred from layout or the filename; needs a human to confirm.
 */
export type MetadataConfidence = "high" | "medium" | "low";

/**
 * Renders a PDF page and reads its text optically. Supplied by the host
 * package, because rendering needs a canvas the core cannot assume exists.
 */
export interface PdfOcrEngine {
  recognize(pdfBytes: Uint8Array, pageNumbers: number[]): Promise<string>;
}

// A run of page-1 text sharing the same font size, in reading order. Used to
// recover the title (largest font near the top) and the author line below it.
export interface TextBlock {
  size: number;
  text: string;
}

/**
 * Minimal pdfjs-like document surface required by the extractor. Concrete
 * pdfjs documents satisfy this shape; consumers may pass mocks in tests.
 */
export interface PdfDocumentLike {
  numPages: number;
  getMetadata(): Promise<PdfMetadataLike | undefined>;
  getPage(n: number): Promise<PdfPageLike>;
  destroy(): void | Promise<void>;
}

/**
 * The two metadata containers a PDF can carry: the legacy Info dictionary and
 * the XMP packet. Publishers put real bibliographic data (journal, volume,
 * DOI, ISSN) in XMP, so it is a far better source than Info.
 */
export interface PdfMetadataLike {
  info?: Record<string, unknown>;
  metadata?: XmpMetadataLike | null | undefined;
}

/** pdfjs' Metadata object — key/value view over the XMP packet. */
export interface XmpMetadataLike {
  getAll?(): Record<string, unknown> | Map<string, unknown> | undefined;
  get?(name: string): unknown;
}

export interface PdfPageLike {
  getTextContent(options?: { normalizeWhitespace?: boolean }): Promise<{
    items: Array<{ str?: string; transform?: number[] }>;
  }>;
  // Optional: many publisher PDFs expose the DOI only as a link annotation,
  // which survives even when the text layer has an unusable encoding.
  getAnnotations?(): Promise<Array<{ url?: unknown; unsafeUrl?: unknown }>>;
}

/**
 * Strategy for opening a PDF byte buffer into a PdfDocumentLike. The Node
 * loader lives in @labshelf/vscode; the browser loader lives in
 * @labshelf/browser. Core never imports pdfjs directly.
 */
export interface PdfDocumentOpener {
  open(bytes: Uint8Array): Promise<PdfDocumentLike>;
}
