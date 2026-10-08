/**
 * Reads the `labshelf.reader.*` settings into the ReaderPrefs shape shared with the reader webview.
 *
 * @depends @labshelf/reader (normalizeReaderPrefs)
 * @dependents pdf-viewer/PdfViewerPanel.ts
 */
import * as vscode from "vscode";
import { normalizeReaderPrefs, type ReaderPrefs } from "@labshelf/reader";

export const READER_CONFIG_SECTION = "labshelf.reader";

const PREF_KEYS: readonly (keyof ReaderPrefs)[] = [
  "vimKeys", "defaultZoom", "toolbarAutoHide", "restorePosition", "hoverPreviews", "hoverDelayMs", "citationStyle",
];

/**
 * Settings are user-editable JSON, so every value is validated (shared normalizeReaderPrefs) and falls back to its default.
 * @usedBy pdf-viewer/PdfViewerPanel.ts
 * @returns the current reader preferences.
 */
export function getReaderPrefs(): ReaderPrefs {
  const cfg = vscode.workspace.getConfiguration(READER_CONFIG_SECTION);
  const raw: Record<string, unknown> = {};
  for (const key of PREF_KEYS) { raw[key] = cfg.get<unknown>(key); }
  return normalizeReaderPrefs(raw);
}

/**
 * Whether the reader opens beside the current editor (ViewColumn.Two) or full-width in the active group (default).
 * @usedBy pdf-viewer/PdfViewerPanel.ts
 * @returns the view column to open the reader panel in.
 */
export function getReaderViewColumn(): vscode.ViewColumn {
  const beside = vscode.workspace.getConfiguration(READER_CONFIG_SECTION).get<unknown>("openBeside");
  return beside === true ? vscode.ViewColumn.Two : vscode.ViewColumn.Active;
}
