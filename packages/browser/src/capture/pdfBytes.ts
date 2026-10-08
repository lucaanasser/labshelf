/**
 * The one pure test that proves bytes are a PDF, kept free of the fetch layer
 * so surfaces that only need the check (the library page's "Attach PDF…") can
 * import it without pulling in htmlPage/pageFacts.
 * @depends none
 * @dependents capture/pdfFetcher, library-page controllers
 */

/** True when the buffer is a PDF: "%PDF-" within its first KiB (some servers prepend junk). */
export function isPdfBytes(bytes: Uint8Array): boolean {
  const head = String.fromCharCode(...bytes.subarray(0, 1024));
  return head.includes("%PDF-");
}
