/**
 * Public surface of the capture module.
 * @depends capture/captureService, capture/pageProbeContentScript
 * @dependents background/index
 */
export { captureActiveTab } from "./captureService";
export type { PageProbeResult } from "./pageProbeContentScript";
