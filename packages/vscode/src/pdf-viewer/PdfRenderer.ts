/**
 * Module: PdfRenderer (re-export shim)
 * Responsibility: Re-export from renderer/ subdirectory for backward compatibility
 */
export {
  PdfRenderer,
  resolvePdfjsUris,
  getPdfjsDirectory,
} from "./renderer/PdfRenderer.js";
export type { RenderParams, ResolvedUris } from "./renderer/PdfRenderer.js";
