/**
 * Barrel export for the pdf-viewer/renderer subdirectory, re-exporting PdfRenderer and its utility functions.
 *
 * @depends pdf-viewer/renderer/PdfRenderer.ts
 * @dependents none (consumers import from pdf-viewer/index.ts or directly from PdfRenderer.ts)
 */
export { PdfRenderer } from "./PdfRenderer.js";
export type { RenderParams, ResolvedUris } from "./PdfRenderer.js";
export { resolvePdfjsUris, getPdfjsDirectory } from "./PdfRenderer.js";
