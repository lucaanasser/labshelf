/**
 * Public surface of the resolver subsystem.
 * @depends ./resolverChain, ./types
 * @dependents capture/captureService
 */
export { resolvePdfUrl } from "./resolverChain";
export type { ResolveContext, ResolvedPdf, PdfResolver } from "./types";
