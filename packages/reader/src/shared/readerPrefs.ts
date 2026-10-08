/**
 * Validation of reader preferences coming from user-editable storage (VS Code settings, browser storage) into the ReaderPrefs shape.
 *
 * @depends shared/protocol.ts
 * @dependents vscode pdf-viewer/readerPrefs.ts, browser reader/readerPrefsStore.ts, browser options/index.ts
 */
import { DEFAULT_READER_PREFS, type CitationStyle, type ReaderPrefs, type ZoomPreset } from "./protocol.js";

const ZOOM_PRESETS: readonly ZoomPreset[] = ["page-width", "page-fit", "page-actual", "auto"];
const CITATION_STYLES: readonly CitationStyle[] = ["pandoc", "latex", "author-year", "citekey"];
const MAX_HOVER_DELAY_MS = 2000;

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/**
 * Every value is validated on its own and falls back to its default, so one bad entry never discards the rest.
 * @usedBy vscode pdf-viewer/readerPrefs.ts (getReaderPrefs), browser reader/readerPrefsStore.ts
 * @returns complete, valid reader preferences.
 */
export function normalizeReaderPrefs(raw: Readonly<Record<string, unknown>> | null | undefined): ReaderPrefs {
  const src = raw ?? {};
  const d = DEFAULT_READER_PREFS;
  const bool = (key: keyof ReaderPrefs, fallback: boolean): boolean => {
    const v = src[key];
    return typeof v === "boolean" ? v : fallback;
  };
  const delay = src["hoverDelayMs"];
  return {
    vimKeys: bool("vimKeys", d.vimKeys),
    defaultZoom: oneOf(src["defaultZoom"], ZOOM_PRESETS, d.defaultZoom),
    toolbarAutoHide: bool("toolbarAutoHide", d.toolbarAutoHide),
    restorePosition: bool("restorePosition", d.restorePosition),
    hoverPreviews: bool("hoverPreviews", d.hoverPreviews),
    hoverDelayMs: typeof delay === "number" && Number.isFinite(delay)
      ? Math.min(MAX_HOVER_DELAY_MS, Math.max(0, delay))
      : d.hoverDelayMs,
    citationStyle: oneOf(src["citationStyle"], CITATION_STYLES, d.citationStyle),
  };
}
