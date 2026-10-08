/**
 * Reader page themes and their runtime list.
 */
export const PDF_THEMES = ["auto", "light", "dark", "sepia", "high-contrast"] as const;
export type PdfTheme = (typeof PDF_THEMES)[number];

/**
 * @returns true when `value` is one of the reader themes.
 */
export function isPdfTheme(value: unknown): value is PdfTheme {
  return (PDF_THEMES as readonly unknown[]).includes(value);
}
