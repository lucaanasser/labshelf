/**
 * Per-paper reading position persisted in the sidecar, plus the defensive normalizer applied to anything read from disk or received from the webview.
 */

export type SidebarTab = "thumbnails" | "outline" | "annotations";

export interface SidebarState {
  open: boolean;
  tab: SidebarTab;
  width?: number;
}

export interface ReadingState {
  page: number;
  /** A numeric scale as a string ("1.25") or a pdf.js preset ("page-width", "page-fit", "page-actual", "auto"). */
  scaleValue: string;
  /** Offsets in pdf.js location space (PDF points from the page's top-left origin). */
  left?: number;
  top?: number;
  sidebar?: SidebarState;
  updatedAt: string;
}

const SCALE_PRESETS = new Set(["page-width", "page-fit", "page-actual", "auto"]);
const SIDEBAR_TABS = new Set<SidebarTab>(["thumbnails", "outline", "annotations"]);
export const MIN_SIDEBAR_WIDTH = 160;
export const MAX_SIDEBAR_WIDTH = 480;

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function normalizeScaleValue(v: unknown): string | null {
  if (typeof v !== "string") { return null; }
  if (SCALE_PRESETS.has(v)) { return v; }
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n <= 64 ? String(n) : null;
}

function normalizeSidebar(v: unknown): SidebarState | undefined {
  if (typeof v !== "object" || v === null) { return undefined; }
  const o = v as Record<string, unknown>;
  if (typeof o["open"] !== "boolean" || !SIDEBAR_TABS.has(o["tab"] as SidebarTab)) { return undefined; }
  const out: SidebarState = { open: o["open"], tab: o["tab"] as SidebarTab };
  if (finite(o["width"])) {
    out.width = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, Math.round(o["width"])));
  }
  return out;
}

/**
 * Validates an untrusted reading-state value; a corrupt value is dropped rather than half-applied.
 * @returns a clean ReadingState, or undefined when the input is unusable.
 */
export function normalizeReadingState(raw: unknown): ReadingState | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) { return undefined; }
  const o = raw as Record<string, unknown>;
  const scaleValue = normalizeScaleValue(o["scaleValue"]);
  if (!finite(o["page"]) || o["page"] < 1 || scaleValue === null) { return undefined; }
  const out: ReadingState = {
    page: Math.floor(o["page"]),
    scaleValue,
    updatedAt: typeof o["updatedAt"] === "string" ? o["updatedAt"] : new Date(0).toISOString(),
  };
  if (finite(o["left"])) { out.left = o["left"]; }
  if (finite(o["top"])) { out.top = o["top"]; }
  const sidebar = normalizeSidebar(o["sidebar"]);
  if (sidebar) { out.sidebar = sidebar; }
  return out;
}

/**
 * Clamps a stored page to the document actually opened, which may have been replaced since the state was saved.
 * @returns a page number within [1, totalPages].
 */
export function clampPage(page: number, totalPages: number): number {
  if (!Number.isFinite(page)) { return 1; }
  return Math.min(Math.max(1, Math.floor(page)), Math.max(1, totalPages));
}
