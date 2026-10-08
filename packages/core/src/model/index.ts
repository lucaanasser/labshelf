/**
 * Shared domain model: paper records, statuses, text layers, annotations, themes, log entries.
 */
export type { PaperRecord } from "./paperRecord.js";
export { PAPER_STATUSES, isPaperStatus } from "./paperStatus.js";
export type { PaperStatus } from "./paperStatus.js";
export { TEXT_LAYER_STATES, parseTextLayerInfo } from "./textLayer.js";
export type { TextLayerState, TextLayerInfo } from "./textLayer.js";
export { ANNOTATION_TYPES, ANNOTATION_COLORS, isAnnotationColor } from "./annotation.js";
export type { Annotation, AnnotationPosition, AnnotationType, AnnotationColor } from "./annotation.js";
export { PDF_THEMES, isPdfTheme } from "./pdfTheme.js";
export type { PdfTheme } from "./pdfTheme.js";
export type { BatchImportResult } from "./batchImport.js";
export type { LogEntry } from "./logEntry.js";
