/** Turns text-layer checks and OCR jobs into the verdict stored on a paper, and decides when a new verdict is worth writing. */
import type { TextLayerInfo } from "../../../model/index.js";
import type { TextLayerDetection, TextLayerOutcome } from "./textLayerTypes.js";

/** @returns the current time as an ISO timestamp */
export function wallClock(): string {
  return new Date().toISOString();
}

/** @returns the verdict an OCR job's outcome leaves on the paper */
export function verdictForOutcome(outcome: TextLayerOutcome, now: () => string = wallClock): TextLayerInfo {
  const checkedAt = now();
  switch (outcome.status) {
    case "added":
      return {
        state: "ocr",
        ocrPages: outcome.pagesAdded,
        ...(outcome.pagesFailed > 0 ? { failedPages: outcome.pagesFailed } : {}),
        checkedAt,
      };
    case "not-needed":
      return { state: outcome.layer, checkedAt };
    case "cancelled":
      return { state: "missing", reason: "OCR was cancelled", checkedAt };
    case "skipped":
      return { state: "missing", reason: outcome.reason, checkedAt };
    case "unavailable":
      return { state: "failed", reason: outcome.reason, checkedAt };
  }
}

/** @returns the verdict a text-layer check (no OCR) leaves on the paper */
export function verdictForDetection(detection: TextLayerDetection, now: () => string = wallClock): TextLayerInfo {
  const checkedAt = now();
  switch (detection.status) {
    case "missing":
      return { state: "missing", checkedAt };
    case "unavailable":
      return { state: "failed", reason: detection.reason, checkedAt };
    default:
      return { state: detection.status, checkedAt };
  }
}

/** @returns the verdict for a check that threw */
export function verdictForError(error: unknown, now: () => string = wallClock): TextLayerInfo {
  return { state: "failed", reason: error instanceof Error ? error.message : String(error), checkedAt: now() };
}

/**
 * Whether a new verdict should replace the stored one. An unchanged verdict is not rewritten, which keeps a
 * library-wide check from touching every file.
 * @returns true when the verdict is worth writing
 */
export function shouldRecordVerdict(current: TextLayerInfo | undefined, next: TextLayerInfo): boolean {
  return !sameVerdict(current, next) && !keepsOcrDetail(current, next);
}

// Re-checking a paper LabShelf read itself finds text (an OCR layer at best, native-looking text at worst) and knows
// less than the record does (how many pages were read). The record wins.
function keepsOcrDetail(current: TextLayerInfo | undefined, next: TextLayerInfo): boolean {
  return current?.state === "ocr" && (next.state === "ocr" || next.state === "native") && next.ocrPages === undefined;
}

function sameVerdict(current: TextLayerInfo | undefined, next: TextLayerInfo): boolean {
  return current !== undefined && current.state === next.state && current.reason === next.reason
    && current.ocrPages === next.ocrPages && current.failedPages === next.failedPages;
}
