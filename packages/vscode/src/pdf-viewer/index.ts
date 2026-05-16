/**
 * Module: PDF Viewer
 * Responsibility: Re-export public API for the pdf-viewer module
 * Dependencies: PdfViewerPanel, ThemeManager, AnnotationManager, PdfRenderer, config
 */
export { PdfViewerPanel } from "./PdfViewerPanel.js";
export { ThemeManager } from "./ThemeManager.js";
export { AnnotationManager } from "./AnnotationManager.js";
export { PdfRenderer, resolvePdfjsUris, getPdfjsDirectory } from "./PdfRenderer.js";
export { PDF_VIEWER_CONFIG } from "./config.js";
export type { ZoomLevel } from "./config.js";
export type { RenderParams, ResolvedUris } from "./PdfRenderer.js";
