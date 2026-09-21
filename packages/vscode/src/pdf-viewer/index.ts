/**
 * Public barrel export for the pdf-viewer module, exposing the panel, managers, renderer, config, and all related types.
 *
 * @depends pdf-viewer/PdfViewerPanel.ts, pdf-viewer/ThemeManager.ts, pdf-viewer/AnnotationManager.ts, pdf-viewer/PdfRenderer.ts, pdf-viewer/config.ts
 * @dependents none (consumers import the concrete modules)
 */
export { PdfViewerPanel, READER_VIEW_TYPE } from "./PdfViewerPanel.js";
export type { PdfViewerDeps, OpenOptions, ReadingStateStore } from "./PdfViewerPanel.js";
export { ThemeManager } from "./ThemeManager.js";
export { AnnotationManager } from "./AnnotationManager.js";
export { PdfRenderer, resolvePdfjsUris, getPdfjsDirectory } from "./PdfRenderer.js";
export { PDF_VIEWER_CONFIG } from "./config.js";
export type { RenderParams, ResolvedUris } from "./PdfRenderer.js";
