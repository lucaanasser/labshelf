/**
 * Extracts per-page text from a paper's PDF using the existing PdfDocumentOpener
 * adapter, then runs the @labshelf/core section detector to produce structured
 * input for the ingestion pipeline. Falls back to per-page chunks when no
 * headings are detected.
 */
import * as vscode from "vscode";
import type { ExtractedPdfText, LocalFileSystem, PdfDocumentLike, PdfDocumentOpener } from "@labshelf/core";
import { detectSections } from "@labshelf/core";

export class PdfTextExtractor {
  constructor(
    private readonly opener: PdfDocumentOpener,
    private readonly fileSystem: Pick<LocalFileSystem, "readFile">,
  ) {}

  /**
   * Reads the PDF at `pdfUri` and returns its per-page text plus detected
   * sections, packaged for the @labshelf/core pipeline.
   *
   * @returns Extracted text with paperId metadata.
   */
  async extract(paperId: string, pdfUri: vscode.Uri): Promise<ExtractedPdfText> {
    const bytes = await this.fileSystem.readFile(pdfUri.fsPath);
    const document = await this.opener.open(bytes);
    try {
      const pages = await collectPageTexts(document);
      const sections = detectSections(pages);
      return { paperId, pages, sections };
    } finally {
      try {
        await document.destroy();
      } catch {
        // pdfjs cleanup failures must not block ingestion.
      }
    }
  }
}

async function collectPageTexts(
  document: PdfDocumentLike,
): Promise<{ page: number; text: string }[]> {
  const out: { page: number; text: string }[] = [];
  const total = document.numPages ?? 0;
  for (let page = 1; page <= total; page += 1) {
    const handle = await document.getPage(page);
    const content = await handle.getTextContent({ normalizeWhitespace: true });
    const text = content.items
      .map((item) => item.str ?? "")
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (text) out.push({ page, text });
  }
  return out;
}
