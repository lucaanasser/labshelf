/**
 * Single source of the page-pixel colours each reader theme hands to pdf.js `pageColors`.
 *
 * @depends shared/protocol.ts (types only)
 * @dependents webview/ui/theme.ts, webview/ui/viewerSetup.ts
 */
import type { EffectiveTheme } from "./protocol.js";

export interface PagePreset {
  bg: string;
  text: string;
}

export const THEME_PRESETS: Record<EffectiveTheme, PagePreset> = {
  "light": { bg: "#ffffff", text: "#000000" },
  "dark": { bg: "#1e1e1e", text: "#e8e8e8" },
  "sepia": { bg: "#faf6ee", text: "#3a2a1a" },
  "high-contrast": { bg: "#000000", text: "#ffffff" },
};

/**
 * Looks up a preset, falling back to light for an unknown theme name.
 * @usedBy webview/ui/theme.ts
 * @returns the page colours for the theme.
 */
export function presetFor(theme: string): PagePreset {
  return (THEME_PRESETS as Record<string, PagePreset>)[theme] ?? THEME_PRESETS.light;
}

/**
 * pdf.js treats `null` pageColors as "render the PDF's own colours"; black on white must map to that so the light theme never recolours figures.
 * @usedBy webview/ui/theme.ts, webview/ui/viewerSetup.ts
 * @returns a pageColors object, or null for untouched rendering.
 */
export function toPageColors(bg: string, text: string): { background: string; foreground: string } | null {
  const isIdentity = bg.toLowerCase() === "#ffffff" && text.toLowerCase() === "#000000";
  return isIdentity ? null : { background: bg, foreground: text };
}
