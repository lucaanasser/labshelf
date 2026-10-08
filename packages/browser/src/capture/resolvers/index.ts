/**
 * Public surface of the resolver subsystem.
 * @depends ./resolverChain, ./types
 * @dependents capture/captureService
 */
export { resolvePdf } from "./resolverChain";
export type { PdfAttempt } from "./resolverChain";
export type { ResolveContext, ResolvedPdf, PdfResolver } from "./types";
