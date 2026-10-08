/**
 * Theme preference shared by every browser surface. VS Code follows its colour
 * theme; here the page follows the OS unless the user pins light or dark. The
 * resolved value lives on <html data-theme> so tokens.css needs no media query,
 * and the preference is stored in localStorage so it applies before paint via
 * ui/themeBoot.ts. A storage event keeps every open surface in step.
 *
 * @depends none
 * @dependents ui/themeBoot, library-page statusBarView, options
 */

export type ThemePref = "auto" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "labshelf.theme";

const listeners = new Set<(theme: ResolvedTheme, pref: ThemePref) => void>();
let media: MediaQueryList | null = null;

/** Reads the stored preference, defaulting to "auto". */
export function getThemePref(): ThemePref {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    return raw === "light" || raw === "dark" ? raw : "auto";
  } catch {
    return "auto";
  }
}

/** Resolves a preference against the OS colour scheme. */
export function resolveTheme(pref: ThemePref): ResolvedTheme {
  if (pref !== "auto") return pref;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

/** Applies the resolved theme to <html> and notifies subscribers. */
export function applyTheme(pref: ThemePref = getThemePref()): ResolvedTheme {
  const theme = resolveTheme(pref);
  document.documentElement.dataset["theme"] = theme;
  for (const cb of listeners) cb(theme, pref);
  return theme;
}

/** Persists a preference and applies it. */
export function setThemePref(pref: ThemePref): void {
  try {
    if (pref === "auto") localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, pref);
  } catch { /* private mode — apply for this page only */ }
  applyTheme(pref);
}

/** Cycles auto → light → dark → auto, the way the status-bar toggle expects. */
export function cycleThemePref(): ThemePref {
  const next: Record<ThemePref, ThemePref> = { auto: "light", light: "dark", dark: "auto" };
  const pref = next[getThemePref()];
  setThemePref(pref);
  return pref;
}

/** Subscribes to theme changes (OS, other surfaces, or this page). Fires immediately. */
export function onThemeChange(cb: (theme: ResolvedTheme, pref: ThemePref) => void): () => void {
  listeners.add(cb);
  cb(resolveTheme(getThemePref()), getThemePref());
  ensureWatchers();
  return () => { listeners.delete(cb); };
}

function ensureWatchers(): void {
  if (media) return;
  media = window.matchMedia("(prefers-color-scheme: light)");
  media.addEventListener("change", () => { if (getThemePref() === "auto") applyTheme("auto"); });
  window.addEventListener("storage", (e) => { if (e.key === THEME_STORAGE_KEY) applyTheme(); });
}
