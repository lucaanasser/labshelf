/**
 * Reads the `labshelf.reader.*` settings into the ReaderPrefs shape shared with the reader webview.
 *
 * @depends pdf-viewer/shared/protocol.ts
 * @dependents pdf-viewer/PdfViewerPanel.ts
 */
import * as vscode from "vscode";
import { DEFAULT_READER_PREFS, type CitationStyle, type ReaderPrefs, type ZoomPreset } from "./shared/protocol.js";

export const READER_CONFIG_SECTION = "labshelf.reader";

const ZOOM_PRESETS: readonly ZoomPreset[] = ["page-width", "page-fit", "page-actual", "auto"];
const CITATION_STYLES: readonly CitationStyle[] = ["pandoc", "latex", "author-year", "citekey"];

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/**
 * Settings are user-editable JSON, so every value is validated and falls back to its default.
 * @usedBy pdf-viewer/PdfViewerPanel.ts
 * @returns the current reader preferences.
 */
export function getReaderPrefs(): ReaderPrefs {
  const cfg = vscode.workspace.getConfiguration(READER_CONFIG_SECTION);
  const d = DEFAULT_READER_PREFS;
  const bool = (key: string, fallback: boolean): boolean => {
    const v = cfg.get<unknown>(key);
    return typeof v === "boolean" ? v : fallback;
  };
  const delay = cfg.get<unknown>("hoverDelayMs");
  return {
    vimKeys: bool("vimKeys", d.vimKeys),
    defaultZoom: oneOf(cfg.get<unknown>("defaultZoom"), ZOOM_PRESETS, d.defaultZoom),
    toolbarAutoHide: bool("toolbarAutoHide", d.toolbarAutoHide),
    restorePosition: bool("restorePosition", d.restorePosition),
    hoverPreviews: bool("hoverPreviews", d.hoverPreviews),
    hoverDelayMs: typeof delay === "number" && Number.isFinite(delay) ? Math.min(2000, Math.max(0, delay)) : d.hoverDelayMs,
    citationStyle: oneOf(cfg.get<unknown>("citationStyle"), CITATION_STYLES, d.citationStyle),
  };
}

/**
 * Whether the reader opens beside the current editor (ViewColumn.Two) or replaces it in the active group.
 * @usedBy pdf-viewer/PdfViewerPanel.ts
 * @returns the view column to open the reader panel in.
 */
export function getReaderViewColumn(): vscode.ViewColumn {
  const beside = vscode.workspace.getConfiguration(READER_CONFIG_SECTION).get<unknown>("openBeside");
  return beside === false ? vscode.ViewColumn.Active : vscode.ViewColumn.Two;
}
