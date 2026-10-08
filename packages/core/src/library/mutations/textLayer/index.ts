/** Public API of text-layer verdicts: the outcome types and the rules that turn them into a stored verdict. */
export { shouldRecordVerdict, verdictForDetection, verdictForError, verdictForOutcome, wallClock } from "./textLayerVerdict.js";
export type { ExistingLayer, TextLayerDetection, TextLayerOutcome } from "./textLayerTypes.js";
