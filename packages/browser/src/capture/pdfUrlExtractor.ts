/**
 * Checks whether a URL points directly to a PDF file.
 * When true, captureService skips the content script probe and fetches the URL directly.
 * @depends none
 * @dependents capture/captureService
 */

/**
 * Returns true when the URL's pathname ends in ".pdf", indicating a direct PDF link.
 * @usedBy capture/captureService
 * @returns boolean
 */
export function isPdfUrl(url: string): boolean {
  try {
    const { pathname } = new URL(url);
    return pathname.toLowerCase().endsWith(".pdf");
  } catch {
    return false;
  }
}
