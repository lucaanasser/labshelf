/**
 * Re-export shim for PdfRenderer, resolvePdfjsUris, and getPdfjsDirectory — delegates to the renderer/ subdirectory for backward compatibility.
 *
 * @depends pdf-viewer/renderer/PdfRenderer.ts
 * @dependents pdf-viewer/PdfViewerPanel.ts, pdf-viewer/index.ts
 */
export {
  PdfRenderer,
  resolvePdfjsUris,
  getPdfjsDirectory,
} from "./renderer/PdfRenderer.js";
export type { RenderParams, ResolvedUris } from "./renderer/PdfRenderer.js";
