/**
 * Barrel re-export for the PDF import pipeline.
 *
 * @depends types, textExtraction, extractor, xmp, localSignals, resolver, parser
 * @dependents io/index.ts, downstream packages
 */
export type {
  ParsedPdfImport,
  ResolvedMetadata,
  DetectedIdentifier,
  TextBlock,
  PdfDocumentLike,
  PdfMetadataLike,
  XmpMetadataLike,
  PdfPageLike,
  PdfDocumentOpener,
  PdfOcrEngine,
  IdentifierType,
  MetadataConfidence,
} from "./types.js";
export { detectIdentifiers, doiVariants } from "./identifiers.js";
export {
  crossRefByDoi,
  crossRefSearch,
  arxivById,
  pubMedByPmid,
  pmidFromPmcid,
  openAlexSearch,
  dataCiteByDoi,
  openLibraryByIsbn,
  semanticScholarByTitle,
  semanticScholarByDoi,
  europePmcSearch,
  dblpSearch,
  googleBooksByIsbn,
} from "./registries.js";
export type { RegistryRecord } from "./registries.js";
export {
  extractTitleBlocks,
  extractFirstPagesText,
  extractPageTexts,
  extractLinkUrls,
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
  usableTitle,
  looksLikeNaturalText,
  isSparseText,
  yearFromText,
  timestampsAreTrustworthy,
} from "./extractor.js";
export { metadataFromXmp } from "./xmp.js";
export {
  abstractFromText,
  titleFromPlainText,
  keywordsFromText,
  journalFromRunningHead,
  publisherMetadataFromInfo,
  describeFallback,
} from "./localSignals.js";
export { mergeMetadata, completeness, tidyCitationFields, SOURCE_TRUST } from "./merge.js";
export type { MetadataSource, MergedMetadata } from "./merge.js";
export {
  resolveOnlineMetadata,
  resolveFirstIdentifier,
  searchOnlineByText,
  searchOnlineByTitle,
  searchOnlineByQueries,
  enrichByDoi,
  searchOnlineCandidates,
  titleOverlap,
} from "./resolver.js";
export { PdfImportParser } from "./parser.js";
export type { PdfImportParserOptions } from "./parser.js";
