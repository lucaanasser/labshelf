/**
 * Module: renderer
 * Responsibility: Barrel export for the PDF renderer subdirectory
 */
export { PdfRenderer } from "./PdfRenderer.js";
export type { RenderParams, ResolvedUris } from "./PdfRenderer.js";
export { resolvePdfjsUris, getPdfjsDirectory } from "./PdfRenderer.js";
