/**
 * Persistence for per-user UI preferences of the library page — the browser
 * counterpart of the VS Code webview's `vscode.getState()/setState()`. Sort
 * order, the subfolder toggle, pane widths, collapsed detail sections and the
 * expanded tree nodes survive reloads; folder selection lives in the URL hash.
 *
 * @depends none
 * @dependents library-page/index, views
 */
import type { SortDir, SortKey } from "./libraryStore";

export interface UiPrefs {
  sortKey: SortKey;
  sortDir: SortDir;
  includeSub: boolean;
  detailWidth: number;
  detailCollapsed: boolean;
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  secCollapsed: Record<string, boolean>;
  treeExpanded: string[];
}

export const PREFS_KEY = "labshelf.library.prefs";

export const DEFAULT_PREFS: UiPrefs = {
  sortKey: "title",
  sortDir: 1,
  includeSub: true,
  detailWidth: 272,
  detailCollapsed: false,
  sidebarWidth: 220,
  sidebarCollapsed: false,
  secCollapsed: { notes: true, tags: true, related: true },
  treeExpanded: [],
};

const SORT_KEYS: readonly SortKey[] = ["title", "creator", "year", "publication", "status"];

/** Reads prefs, validating each field so a corrupt entry falls back to its default. */
export function loadPrefs(storage: Pick<Storage, "getItem"> = localStorage): UiPrefs {
  let raw: unknown = null;
  try { raw = JSON.parse(storage.getItem(PREFS_KEY) ?? "null"); } catch { raw = null; }
  return sanitize(raw);
}

/** Merges a patch into the stored prefs. */
export function savePrefs(patch: Partial<UiPrefs>, storage: Storage = localStorage): UiPrefs {
  const next = { ...loadPrefs(storage), ...patch };
  try { storage.setItem(PREFS_KEY, JSON.stringify(next)); } catch { /* private mode */ }
  return next;
}

export function sanitize(raw: unknown): UiPrefs {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_PREFS;
  const num = (v: unknown, fallback: number, min: number, max: number): number =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
  const bool = (v: unknown, fallback: boolean): boolean => (typeof v === "boolean" ? v : fallback);
  return {
    sortKey: SORT_KEYS.includes(r["sortKey"] as SortKey) ? (r["sortKey"] as SortKey) : d.sortKey,
    sortDir: r["sortDir"] === -1 ? -1 : 1,
    includeSub: bool(r["includeSub"], d.includeSub),
    detailWidth: num(r["detailWidth"], d.detailWidth, 220, 620),
    detailCollapsed: bool(r["detailCollapsed"], d.detailCollapsed),
    sidebarWidth: num(r["sidebarWidth"], d.sidebarWidth, 160, 420),
    sidebarCollapsed: bool(r["sidebarCollapsed"], d.sidebarCollapsed),
    secCollapsed: isBoolMap(r["secCollapsed"]) ? r["secCollapsed"] : { ...d.secCollapsed },
    treeExpanded: Array.isArray(r["treeExpanded"]) ? r["treeExpanded"].filter((x): x is string => typeof x === "string") : [],
  };
}

function isBoolMap(v: unknown): v is Record<string, boolean> {
  return !!v && typeof v === "object" && !Array.isArray(v) && Object.values(v as object).every((x) => typeof x === "boolean");
}
