/**
 * Reads raw text from a PdfDocumentLike — page-1 font-grouped blocks for title
 * inference, and concatenated text from the first N pages for identifier detection.
 *
 * @depends io/pdf/types.ts
 * @dependents io/pdf/parser.ts
 */
import type { PdfDocumentLike, TextBlock } from "./types.js";

/**
 * Groups page-1 text items into runs that share the same font size, in reading order.
 * @usedBy io/pdf/parser.ts
 * @returns Array of TextBlock objects representing font-grouped text runs.
 */
export async function extractTitleBlocks(document: PdfDocumentLike): Promise<TextBlock[]> {
  const page = await document.getPage(1);
  const content = await page.getTextContent();
  const items = content.items;

  const blocks: TextBlock[] = [];
  for (const item of items) {
    const str = item.str ?? "";
    if (!str.trim()) {
      continue;
    }
    const transform = item.transform ?? [1, 0, 0, 1, 0, 0];
    const size = Math.round(Math.hypot(transform[2] ?? 0, transform[3] ?? 1) * 10) / 10;

    const last = blocks[blocks.length - 1];
    if (last && Math.abs(last.size - size) < 1) {
      last.text += /\s$/.test(last.text) || /^\s/.test(str) ? str : ` ${str}`;
    } else {
      blocks.push({ size, text: str });
    }
  }

  return blocks
    .map((block) => ({ size: block.size, text: block.text.replace(/\s+/g, " ").trim() }))
    .filter((block) => block.text.length > 0);
}

/**
 * Concatenates the plain text from the first `pageCount` pages of the PDF document.
 * @usedBy io/pdf/parser.ts
 * @returns Newline-joined string of page text, used for identifier detection.
 */
export async function extractFirstPagesText(document: PdfDocumentLike, pageCount: number): Promise<string> {
  const chunks: string[] = [];
  const limit = Math.min(document.numPages ?? pageCount, pageCount);

  for (let pageNumber = 1; pageNumber <= limit; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const textContent = await page.getTextContent({ normalizeWhitespace: true });
    const pageText = textContent.items
      .map((item) => item.str ?? "")
      .join(" ")
      .trim();
    if (pageText) {
      chunks.push(pageText);
    }
  }

  return chunks.join("\n");
}
