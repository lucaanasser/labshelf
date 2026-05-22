/**
 * Barrel re-export for all shared domain types.
 *
 * @depends paperRecord, annotation, batchImport, logEntry
 * @dependents interfaces/index.ts, @labshelf/core index, downstream packages
 */
export type { PaperStatus, PaperRecord } from "./paperRecord.js";
export type {
  AnnotationPosition,
  AnnotationType,
  AnnotationColor,
  PdfTheme,
  Annotation,
} from "./annotation.js";
export type { BatchImportResult } from "./batchImport.js";
export type { LogEntry } from "./logEntry.js";
