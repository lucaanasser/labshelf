/**
 * Public surface of the capture module.
 * @depends capture/captureService, capture/scholarCapture, capture/recordCapture, capture/addPaperFlow, capture/libraryMatch, capture/doiDetector
 * @dependents background/index
 */
export { inspectTab, findPdf, saveDraft, safeFolder, summarizeAttempts, resetPdfSearch, saveOrAsk, refreshExisting } from "./captureService";
export type { CaptureDraft, SaveOptions, SavedPaper, SaveDecision } from "./captureService";
export { draftFromScholarHit } from "./scholarCapture";
export { idsFromRecord, draftFromRecord } from "./recordCapture";
export { attachPdfToPaper } from "./addPaperFlow";
export { findInLibrary } from "./libraryMatch";
export { detectIdentifiers } from "./doiDetector";
export type { DetectedIds } from "./doiDetector";
