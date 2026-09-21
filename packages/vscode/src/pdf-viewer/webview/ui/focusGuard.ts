/**
 * Stops pdf.js from scrolling the document when it focuses a page's text layer.
 *
 * After a link is followed, PDFLinkService waits for the destination page's text layer to render and then calls
 * `textLayer.div.focus()` for assistive technology. Focus scrolls the element into view. If the reader has already
 * pressed Back by then — the "peek at a reference and return" move — that late focus drags them to the destination
 * again; and even when they stayed, it can nudge the precise XYZ position the link asked for.
 * The focus itself is kept; only its scrolling side effect is removed.
 *
 * @depends none
 * @dependents pdf-viewer/webview/main.ts
 */

let installed = false;

/**
 * Idempotent; must run before pdf.js renders its first text layer.
 * @usedBy pdf-viewer/webview/main.ts
 * @returns void
 */
export function installTextLayerFocusGuard(): void {
  if (installed) { return; }
  installed = true;
  const nativeFocus = HTMLElement.prototype.focus;
  HTMLElement.prototype.focus = function focus(this: HTMLElement, options?: FocusOptions): void {
    if (this.classList.contains("textLayer")) {
      nativeFocus.call(this, { ...options, preventScroll: true });
      return;
    }
    nativeFocus.call(this, options);
  };
}
