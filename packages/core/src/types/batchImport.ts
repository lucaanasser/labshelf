/**
 * Result envelope returned by batch PDF import flows.
 *
 * @depends types/paperRecord.ts
 * @dependents paperService (vscode), captureService (browser)
 */
import type { PaperRecord } from "./paperRecord.js";

export interface BatchImportResult {
  success: PaperRecord[];
  failed: Array<{ path: string; error: string }>;
  skipped: string[];
}
