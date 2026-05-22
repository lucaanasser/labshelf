/**
 * Public surface of the capture module.
 * @depends capture/captureService, capture/pageProbeContentScript, capture/doiDetector
 * @dependents background/index, library-page captureController
 */
export { captureActiveTab } from "./captureService";
export type { CaptureOutcome } from "./captureService";
export type { PageProbeResult } from "./pageProbeContentScript";
export { detectIdentifiers } from "./doiDetector";
export type { DetectedIds } from "./doiDetector";
