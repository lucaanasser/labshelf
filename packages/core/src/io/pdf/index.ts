/**
 * Barrel re-export for the PDF import pipeline.
 *
 * @depends types, textExtraction, extractor, resolver, parser
 * @dependents io/index.ts, downstream packages
 */
export type {
  ParsedPdfImport,
  ResolvedMetadata,
  DetectedIdentifier,
  TextBlock,
  PdfDocumentLike,
  PdfPageLike,
  PdfDocumentOpener,
} from "./types.js";
export {
  extractTitleBlocks,
  extractFirstPagesText,
} from "./textExtraction.js";
export {
  titleFromBlocks,
  authorsFromBlocks,
  detectIdentifier,
  normalizeTitle,
  normalizeAuthors,
  buildCiteKey,
  extractYear,
  asString,
} from "./extractor.js";
export { resolveOnlineMetadata } from "./resolver.js";
export { PdfImportParser } from "./parser.js";
