/** Public API of paper import: PDF discovery, the import itself, the records it builds and the summary it reports. */
export { importPaths, importPdfs } from "./importBatch.js";
export type { ImportProgress } from "./importBatch.js";
export { importedRecord, metadataFields, needsReview, withResolvedMetadata } from "./importedRecord.js";
export type { ParsedImport, RecordMetadata } from "./importedRecord.js";
export { summarizeImport } from "./importSummary.js";
export type { ImportSummary } from "./importSummary.js";
export { doiLookup, importPdf } from "./paperImport.js";
export type { ImportDeps, ImportOptions, ImportOutcome, PdfParse } from "./paperImport.js";
export { discoverPdfs } from "./pdfDiscovery.js";
export type { PdfDiscovery } from "./pdfDiscovery.js";
