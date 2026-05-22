/**
 * Shared type definitions for the PDF import pipeline (identifiers, parsed metadata, resolved metadata).
 *
 * @depends none
 * @dependents io/pdf/parser.ts, io/pdf/extractor.ts, io/pdf/textExtraction.ts, io/pdf/resolver.ts
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

/**
 * Minimal pdfjs-like document surface required by the extractor. Concrete
 * pdfjs documents satisfy this shape; consumers may pass mocks in tests.
 */
export interface PdfDocumentLike {
  numPages: number;
  getMetadata(): Promise<{ info?: Record<string, unknown> } | undefined>;
  getPage(n: number): Promise<PdfPageLike>;
  destroy(): void | Promise<void>;
}

export interface PdfPageLike {
  getTextContent(options?: { normalizeWhitespace?: boolean }): Promise<{
    items: Array<{ str?: string; transform?: number[] }>;
  }>;
}

/**
 * Strategy for opening a PDF byte buffer into a PdfDocumentLike. The Node
 * loader lives in @labshelf/vscode; the browser loader lives in
 * @labshelf/browser. Core never imports pdfjs directly.
 */
export interface PdfDocumentOpener {
  open(bytes: Uint8Array): Promise<PdfDocumentLike>;
}
