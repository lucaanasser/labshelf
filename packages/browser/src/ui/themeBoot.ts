/**
 * Synchronous theme bootstrap. Loaded as a classic <script> in <head> before
 * the stylesheets so <html data-theme> is set before first paint — MV3 forbids
 * inline scripts, hence a separate entry. Keep this file dependency-free and
 * tiny; the full API lives in ui/theme.ts.
 *
 * @depends none
 * @dependents popup/index.html, options/index.html, library-page/index.html, reader/index.html
 */
(() => {
  let pref: string | null = null;
  try { pref = localStorage.getItem("labshelf.theme"); } catch { /* ignore */ }
  const light = pref === "light" || (pref !== "dark" && window.matchMedia("(prefers-color-scheme: light)").matches);
  const root = document.documentElement;
  root.dataset["theme"] = light ? "light" : "dark";
  // The reader page paints its chrome from data-pdf-theme; start it on the "auto" theme until the paper's own arrives.
  if (root.dataset["pdfTheme"] !== undefined) root.dataset["pdfTheme"] = light ? "light" : "dark";
})();
