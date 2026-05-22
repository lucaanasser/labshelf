/**
 * Cross-browser WebExtension API surface. Imported everywhere instead of the
 * raw `chrome.*` or `browser.*` globals so we can target both Chromium and
 * Firefox without conditional code at call sites.
 * @depends webextension-polyfill.
 * @dependents background, popup, options, library-page, sync/auth.
 */
import polyfill from "webextension-polyfill";

export const bx = polyfill;
export type Browser = typeof polyfill;
