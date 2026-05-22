/**
 * Orchestrates the PDF import pipeline — opens a PDF byte buffer through an
 * injected PdfDocumentOpener, extracts metadata and inferred identifiers,
 * and resolves bibliographic data online.
 *
 * Pdfjs bootstrap and worker setup live in the consumer package (VS Code's
 * NodePdfOpener, browser's BrowserPdfOpener). Core never imports pdfjs.
 *
 * @depends io/pdf/types.ts, io/pdf/textExtraction.ts, io/pdf/extractor.ts, io/pdf/resolver.ts
 * @dependents @labshelf/vscode paperService, @labshelf/browser captureService
 */
import type {
  ParsedPdfImport,
  PdfDocumentOpener,
  TextBlock,
} from "./types.js";
import {
  extractTitleBlocks,
  extractFirstPagesText,
} from "./textExtraction.js";
import {
  titleFromBlocks,
  authorsFromBlocks,
  detectIdentifier,
  normalizeTitle,
  normalizeAuthors,
  buildCiteKey,
  extractYear,
  asString,
} from "./extractor.js";
import { resolveOnlineMetadata } from "./resolver.js";

const PDF_HEADER = "%PDF-";

export class PdfImportParser {
  constructor(private readonly opener: PdfDocumentOpener) {}

  /**
   * Parses a PDF byte buffer and returns a structured metadata record including title, authors, year, DOI, and citation key.
   * @usedBy paperService (vscode), captureService (browser)
   * @returns A fully populated ParsedPdfImport object.
   */
  async parse(pdfBytes: Uint8Array, fileStem: string): Promise<ParsedPdfImport> {
    const header = new TextDecoder("utf-8").decode(pdfBytes.slice(0, 5));
    if (header !== PDF_HEADER) {
      throw new Error(`File is not a valid PDF (missing %PDF- header).`);
    }

    const document = await this.openDocument(pdfBytes);
    let pdfInfo: Record<string, unknown> = {};
    let firstPagesText = "";
    let titleBlocks: TextBlock[] = [];

    try {
      const metadata = await document.getMetadata().catch(() => undefined);
      pdfInfo = (metadata?.info as Record<string, unknown>) ?? {};
      firstPagesText = await extractFirstPagesText(document, 2);
      titleBlocks = await extractTitleBlocks(document).catch(() => []);
    } finally {
      await Promise.resolve(document.destroy()).catch(() => undefined);
    }

    const identifier = detectIdentifier(pdfInfo, firstPagesText);
    const resolved = identifier
      ? await resolveOnlineMetadata(identifier).catch(() => undefined)
      : undefined;

    const infoTitle = asString(pdfInfo["Title"]);
    const infoAuthor = asString(pdfInfo["Author"]);
    const creationDate = extractYear(
      asString(pdfInfo["CreationDate"]) ?? asString(pdfInfo["ModDate"]),
    );
    const layoutTitle = titleFromBlocks(titleBlocks);

    const title = normalizeTitle(resolved?.title ?? infoTitle ?? layoutTitle ?? fileStem);
    const authorSource = resolved?.authors ?? infoAuthor;
    const authors = authorSource
      ? normalizeAuthors(authorSource)
      : authorsFromBlocks(titleBlocks, layoutTitle);
    const year = resolved?.year ?? creationDate;
    const doi =
      resolved?.doi ??
      (identifier?.type === "doi" ? identifier.value : asString(pdfInfo["DOI"]));
    const citeKey = buildCiteKey(fileStem, title, year, doi ?? identifier?.value);

    return {
      title,
      citeKey,
      authors,
      ...(year ? { year } : {}),
      ...(doi ? { doi } : {}),
      ...(resolved?.journal ? { journal: resolved.journal } : {}),
      ...(resolved?.publisher ? { publisher: resolved.publisher } : {}),
      ...(resolved?.volume ? { volume: resolved.volume } : {}),
      ...(resolved?.issue ? { issue: resolved.issue } : {}),
      ...(resolved?.pages ? { pages: resolved.pages } : {}),
      ...(resolved?.url ? { url: resolved.url } : {}),
      ...(resolved?.issn ? { issn: resolved.issn } : {}),
      ...(resolved?.language ? { language: resolved.language } : {}),
      ...(resolved?.summary ? { summary: resolved.summary } : {}),
    };
  }

  // Wraps the injected opener with friendly error mapping for password-protected and corrupt PDFs.
  private async openDocument(pdfBytes: Uint8Array) {
    try {
      return await this.opener.open(pdfBytes);
    } catch (error) {
      throw describePdfError(error);
    }
  }
}

// Turns pdfjs' low-level parser errors into a message the user can act on.
function describePdfError(error: unknown): Error {
  const name = (error as { name?: unknown })?.name;
  const message = error instanceof Error ? error.message : String(error);

  if (name === "PasswordException") {
    return new Error("The PDF is password-protected and could not be read.");
  }
  if (name === "InvalidPDFException" || /\b(root reference|xref|invalid pdf)\b/i.test(message)) {
    return new Error("The PDF is corrupted or incomplete and could not be read.");
  }
  return error instanceof Error ? error : new Error(message);
}
