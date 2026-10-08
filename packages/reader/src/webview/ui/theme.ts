/**
 * Applies the reader theme to the chrome (CSS variables keyed on data-pdf-theme) and to the page pixels (pdf.js pageColors).
 *
 * @depends shared/themePresets.ts, shared/protocol.ts, @labshelf/core (types only), pdfjs-dist (types only)
 * @dependents webview/reader.ts, webview/ui/themePopover.ts, webview/ui/thumbnailsTab.ts, webview/ui/destPreview.ts
 */
import type { PdfTheme } from "@labshelf/core";
import type { PDFViewer } from "pdfjs-dist/web/pdf_viewer.mjs";
import type { EffectiveTheme } from "../../shared/protocol.js";
import { presetFor, toPageColors } from "../../shared/themePresets.js";

export type PageColors = { background: string; foreground: string } | null;

const REFRESH_DELAY_MS = 80;

export class ThemeController {
  preference: PdfTheme;
  effective: EffectiveTheme;
  private bg: string;
  private text: string;
  private pdfViewer: PDFViewer | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly listeners: Array<() => void> = [];

  constructor(private readonly container: HTMLElement, preference: PdfTheme, effective: EffectiveTheme) {
    this.preference = preference;
    this.effective = effective;
    const preset = presetFor(effective);
    this.bg = preset.bg;
    this.text = preset.text;
    this.apply(preference, effective);
  }

  /**
   * Supplies the PDFViewer instance once it exists, so later theme changes can push pageColors into it.
   * @usedBy webview/reader.ts
   * @returns void
   */
  attach(pdfViewer: PDFViewer): void {
    this.pdfViewer = pdfViewer;
  }

  get pageColors(): PageColors { return toPageColors(this.bg, this.text); }
  get colors(): { bg: string; text: string } { return { bg: this.bg, text: this.text }; }

  /**
   * Fires after the page colours actually changed, so thumbnails and previews can re-render.
   * @usedBy webview/ui/thumbnailsTab.ts, webview/ui/destPreview.ts
   * @returns void
   */
  onPageColorsChange(fn: () => void): void { this.listeners.push(fn); }

  /**
   * Applies a theme preference/effective pair: updates the chrome's data attribute and the page preset colours.
   * @usedBy webview/reader.ts
   * @returns void
   */
  apply(preference: PdfTheme | undefined, effective: EffectiveTheme | undefined): void {
    if (preference) { this.preference = preference; }
    if (!effective) { return; }
    this.effective = effective;
    document.documentElement.dataset["pdfTheme"] = effective;
    const preset = presetFor(effective);
    this.applyPageColors(preset.bg, preset.text);
  }

  /**
   * Pushes explicit background/text colours into the container and, once changed, into pdf.js' pageColors.
   * @usedBy webview/ui/themePopover.ts
   * @returns void
   */
  applyPageColors(bg: string, text: string): void {
    this.bg = bg;
    this.text = text;
    this.container.style.background = bg;
    const viewer = this.pdfViewer;
    if (!viewer) { return; }
    const colors = toPageColors(bg, text);
    const cur = viewer.pageColors as PageColors;
    const same = (colors === null && cur === null)
      || (colors !== null && cur !== null && cur.background === colors.background && cur.foreground === colors.foreground);
    if (same) { return; }
    viewer.pageColors = colors;
    // pdf.js copies pageColors into each PDFPageView at construction and offers no public setter;
    // `_pages` is private API, pinned by the ~6.3 version range in package.json.
    const pages = (viewer as unknown as { _pages?: Array<{ pageColors: PageColors }> })._pages;
    if (Array.isArray(pages)) {
      for (const pv of pages) { pv.pageColors = colors; }
    }
    if (this.refreshTimer) { clearTimeout(this.refreshTimer); }
    this.refreshTimer = setTimeout(() => {
      viewer.refresh();
      for (const fn of this.listeners) { fn(); }
    }, REFRESH_DELAY_MS);
  }
}
