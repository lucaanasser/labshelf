/**
 * Orchestrates the PDF import pipeline.
 *
 * The goal is to leave as few fields empty as possible, so this does not stop
 * at the first source that answers. It collects everything available and then
 * merges field by field, letting a weak source fill what a strong one omitted:
 *
 *   1. identifiers (DOI/arXiv/PMID/PMC/ISBN) from metadata, links and text,
 *      each confirmed against the registry that issued it;
 *   2. OCR of the rendered front matter — when the text layer is unreadable,
 *      and again as a last resort when nothing else identified the paper;
 *   3. a search across every registry, retried with differently-shaped queries;
 *   4. enrichment: once a DOI is known, other registries are asked to fill the
 *      gaps the first one left, most often the abstract;
 *   5. the embedded XMP packet and publisher-specific Info keys;
 *   6. the page text itself — abstract, keywords, running head;
 *   7. page-1 layout heuristics, then the filename.
 *
 * Only after all of that does the caller fall back to asking the user.
 *
 * Pdfjs bootstrap and worker setup live in the consumer package (VS Code's
 * NodePdfOpener, browser's BrowserPdfOpener). Core never imports pdfjs.
 *
 * @depends io/pdf/types.ts, io/pdf/textExtraction.ts, io/pdf/extractor.ts, io/pdf/identifiers.ts, io/pdf/resolver.ts, io/pdf/xmp.ts, io/pdf/localSignals.ts, io/pdf/merge.ts
 * @dependents @labshelf/vscode paperService, @labshelf/browser captureService
 */
import type {
  MetadataConfidence,
  ParsedPdfImport,
  PdfDocumentLike,
  PdfDocumentOpener,
  PdfOcrEngine,
  ResolvedMetadata,
  TextBlock,
} from "./types.js";
import {
  extractTitleBlocks,
  extractPageTexts,
  extractLinkUrls,
} from "./textExtraction.js";
import {
  titleFromBlocks,
  authorsFromBlocks,
  normalizeTitle,
  normalizeAuthors,
  buildCiteKey,
  extractYear,
  asString,
  usableTitle,
  looksLikeNaturalText,
  isSparseText,
  yearFromText,
  timestampsAreTrustworthy,
} from "./extractor.js";
import { detectIdentifiers } from "./identifiers.js";
import {
  enrichByDoi,
  resolveFirstIdentifier,
  searchOnlineByQueries,
} from "./resolver.js";
import { metadataFromXmp } from "./xmp.js";
import {
  abstractFromText,
  titleFromPlainText,
  keywordsFromText,
  journalFromRunningHead,
  publisherMetadataFromInfo,
} from "./localSignals.js";
import { mergeMetadata, SOURCE_TRUST, type MetadataSource } from "./merge.js";

const PDF_HEADER = "%PDF-";
// Front matter carrying the title, authors and DOI rarely runs past page 3.
const FRONT_MATTER_PAGES = 3;
// OCR is expensive, so only the pages that carry the masthead are read.
const OCR_PAGES = [1, 2];

export interface PdfImportParserOptions {
  // Optional: enables recovery of PDFs whose text layer is scanned or whose
  // fonts carry a broken character map.
  ocr?: PdfOcrEngine | undefined;
}

// Everything read out of the file itself, before anything goes over the network.
interface PdfSignals {
  info: Record<string, unknown>;
  xmp: ResolvedMetadata | undefined;
  pageTexts: string[];
  frontMatter: string;
  titleBlocks: TextBlock[];
  linkUrls: string[];
}

export class PdfImportParser {
  private readonly ocr: PdfOcrEngine | undefined;

  constructor(
    private readonly opener: PdfDocumentOpener,
    options: PdfImportParserOptions = {},
  ) {
    this.ocr = options.ocr;
  }

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

    const signals = await this.readPdf(pdfBytes);

    // Fonts without a usable character map yield scrambled text. Such text can
    // still hide an identifier by luck, but must never become a title or name.
    const embeddedIsReadable = looksLikeNaturalText(signals.frontMatter);
    let frontMatter = signals.frontMatter;
    let usedOcr = false;
    let ocrTitle: string | undefined;

    // A near-empty text layer passes the readability test for lack of evidence,
    // yet says nothing about the paper: the pages are scans, or were re-printed
    // from a browser. Whatever title the file claims then is the printer's.
    const embeddedIsSparse = isSparseText(signals.pageTexts);

    if (!embeddedIsReadable || embeddedIsSparse) {
      const ocrText = await this.runOcr(pdfBytes);
      if (ocrText) {
        // A sparse layer is a stamp or print header repeated on every page. It
        // may still hold an identifier, so it is kept — but behind the OCR text,
        // or it would be all that the registry search ever sees.
        frontMatter = embeddedIsReadable ? `${ocrText}\n${frontMatter}`.trim() : ocrText;
        usedOcr = true;
        ocrTitle = usableTitle(titleFromPlainText(ocrText));
      }
    }

    let identifiers = detectIdentifiers(signals.info, frontMatter, signals.linkUrls);
    let confirmed = await resolveFirstIdentifier(identifiers).catch(() => undefined);

    const layoutTitle = embeddedIsReadable ? titleFromBlocks(signals.titleBlocks) : undefined;
    let localTitle = usableTitle(signals.xmp?.title) ?? usableTitle(asString(signals.info["Title"])) ?? layoutTitle;

    // Nothing identified the paper and the file offers no title either. The
    // text layer may be readable yet empty of front matter — a title page
    // stored as an image. Reading it optically is the last thing left to try.
    if (!confirmed && !localTitle && !usedOcr) {
      const ocrText = await this.runOcr(pdfBytes);
      if (ocrText) {
        frontMatter = `${ocrText}\n${frontMatter}`.trim();
        usedOcr = true;
        ocrTitle = usableTitle(titleFromPlainText(ocrText));
        identifiers = detectIdentifiers(signals.info, frontMatter, signals.linkUrls);
        confirmed = await resolveFirstIdentifier(identifiers).catch(() => undefined);
      }
    }

    const textIsReadable = embeddedIsReadable || looksLikeNaturalText(frontMatter);
    const abstract = textIsReadable ? abstractFromText(frontMatter) : undefined;
    // OCR text has no font sizes, so its title is a guess from line shape alone.
    localTitle ??= textIsReadable ? ocrTitle : undefined;

    let resolved = confirmed?.metadata;
    let origin = confirmed ? `${confirmed.identifier.type}:${confirmed.identifier.value}` : undefined;

    // No identifier resolved — ask the registries to recognise the paper the
    // way a reader would, trying several shapes of the same question.
    if (!resolved && textIsReadable) {
      const match = await searchOnlineByQueries([
        localTitle,
        localTitle && firstAuthorHint(signals) ? `${localTitle} ${firstAuthorHint(signals)}` : undefined,
        frontMatterQuery(frontMatter),
        abstract?.slice(0, 300),
      ]).catch(() => undefined);
      if (match) {
        resolved = match.metadata;
        origin = usedOcr ? "search:ocr" : "search:text";
      }
    }

    const sources: MetadataSource[] = [];
    if (resolved) {
      sources.push({
        name: origin ?? "registry",
        trust: confirmed ? SOURCE_TRUST.confirmedIdentifier : SOURCE_TRUST.search,
        metadata: resolved,
      });
      // A confirmed DOI unlocks the other registries, which fill the gaps the
      // first one left — CrossRef omits the abstract for most of its records.
      const doi = resolved.doi ?? (confirmed?.identifier.type === "doi" ? confirmed.identifier.value : undefined);
      if (doi) {
        sources.push(...(await enrichByDoi(doi).catch((): MetadataSource[] => [])));
      }
    }

    sources.push(
      { name: "xmp", trust: SOURCE_TRUST.xmp, metadata: signals.xmp },
      { name: "publisher-info", trust: SOURCE_TRUST.publisherInfo, metadata: publisherMetadataFromInfo(signals.info) },
      { name: "pdf-text", trust: SOURCE_TRUST.pdfText, metadata: this.textSignals(signals, frontMatter, textIsReadable, abstract) },
      { name: "info", trust: SOURCE_TRUST.info, metadata: this.infoSignals(signals) },
      { name: "layout", trust: SOURCE_TRUST.layout, metadata: this.layoutSignals(signals, layoutTitle, embeddedIsReadable) },
      { name: "ocr-layout", trust: SOURCE_TRUST.layout, metadata: textIsReadable && ocrTitle ? { title: ocrTitle } : undefined },
    );

    const merged = mergeMetadata(sources);
    const metadata = merged.metadata;
    const title = normalizeTitle(metadata.title ?? fileStem);
    const year = metadata.year ?? (textIsReadable ? yearFromText(frontMatter) : undefined);
    const citeKey = buildCiteKey(fileStem, title, year, metadata.doi ?? identifiers[0]?.value);

    return {
      title,
      citeKey,
      authors: normalizeAuthors(metadata.authors),
      confidence: gradeConfidence(Boolean(confirmed), Boolean(resolved), metadata),
      ...optional("source", describeOrigin(origin, merged.fieldSources, usedOcr)),
      ...(year ? { year } : {}),
      ...optional("doi", metadata.doi),
      ...optional("journal", metadata.journal),
      ...optional("publisher", metadata.publisher),
      ...optional("volume", metadata.volume),
      ...optional("issue", metadata.issue),
      ...optional("pages", metadata.pages),
      ...optional("url", metadata.url),
      ...optional("issn", metadata.issn),
      ...optional("language", metadata.language),
      ...optional("summary", metadata.summary),
      ...(metadata.keywords?.length ? { keywords: metadata.keywords } : {}),
    };
  }

  // Reads every signal the file itself carries, in one pass over the document.
  private async readPdf(pdfBytes: Uint8Array): Promise<PdfSignals> {
    const document = await this.openDocument(pdfBytes);
    try {
      const metadata = await document.getMetadata().catch(() => undefined);
      const pageTexts = await extractPageTexts(document, FRONT_MATTER_PAGES);
      return {
        info: (metadata?.info as Record<string, unknown>) ?? {},
        xmp: metadataFromXmp(metadata?.metadata),
        pageTexts,
        frontMatter: pageTexts.join("\n"),
        titleBlocks: await extractTitleBlocks(document).catch((): TextBlock[] => []),
        linkUrls: await extractLinkUrls(document, FRONT_MATTER_PAGES).catch((): string[] => []),
      };
    } finally {
      await Promise.resolve(document.destroy()).catch(() => undefined);
    }
  }

  // What the page text alone can supply when no registry knows this paper.
  private textSignals(
    signals: PdfSignals,
    frontMatter: string,
    readable: boolean,
    abstract: string | undefined,
  ): ResolvedMetadata | undefined {
    if (!readable) {
      return undefined;
    }
    const keywords = keywordsFromText(frontMatter);
    const journal = journalFromRunningHead(signals.pageTexts);
    const metadata: ResolvedMetadata = {
      ...(abstract ? { summary: abstract } : {}),
      ...(keywords.length ? { keywords } : {}),
      ...(journal ? { journal } : {}),
    };
    return Object.keys(metadata).length > 0 ? metadata : undefined;
  }

  private infoSignals(signals: PdfSignals): ResolvedMetadata | undefined {
    const title = usableTitle(asString(signals.info["Title"]));
    const authors = normalizeAuthors(asString(signals.info["Author"]));
    // A re-saved PDF's timestamps say when it was printed, not published.
    const year = timestampsAreTrustworthy(signals.info)
      ? extractYear(asString(signals.info["CreationDate"]) ?? asString(signals.info["ModDate"]))
      : undefined;
    const keywords = keywordsFromText(`Keywords: ${asString(signals.info["Keywords"]) ?? ""}`);

    const metadata: ResolvedMetadata = {
      ...(title ? { title } : {}),
      ...(authors.length ? { authors } : {}),
      ...(year ? { year } : {}),
      ...(keywords.length ? { keywords } : {}),
    };
    return Object.keys(metadata).length > 0 ? metadata : undefined;
  }

  private layoutSignals(
    signals: PdfSignals,
    layoutTitle: string | undefined,
    readable: boolean,
  ): ResolvedMetadata | undefined {
    if (!readable || !layoutTitle) {
      return undefined;
    }
    const authors = authorsFromBlocks(signals.titleBlocks, layoutTitle);
    return { title: layoutTitle, ...(authors.length ? { authors } : {}) };
  }

  // Reads the front matter optically; failures degrade to no OCR text at all.
  private async runOcr(pdfBytes: Uint8Array): Promise<string> {
    if (!this.ocr) {
      return "";
    }
    return this.ocr.recognize(pdfBytes, OCR_PAGES).catch(() => "");
  }

  // Wraps the injected opener with friendly error mapping for password-protected and corrupt PDFs.
  private async openDocument(pdfBytes: Uint8Array): Promise<PdfDocumentLike> {
    try {
      return await this.opener.open(pdfBytes);
    } catch (error) {
      throw describePdfError(error);
    }
  }
}

// The masthead holds the title and authors; feeding the whole page to a search
// index buries them under boilerplate and affiliations.
function frontMatterQuery(text: string): string | undefined {
  const head = text.replace(/\s+/g, " ").trim().slice(0, 400);
  return head.length >= 20 ? head : undefined;
}

// A surname next to a generic title is often what makes a search unambiguous.
function firstAuthorHint(signals: PdfSignals): string | undefined {
  const author = signals.xmp?.authors?.[0] ?? normalizeAuthors(asString(signals.info["Author"]))[0];
  return author?.split(/\s+/).pop();
}

function gradeConfidence(
  identifierConfirmed: boolean,
  resolvedOnline: boolean,
  metadata: ResolvedMetadata,
): MetadataConfidence {
  if (identifierConfirmed) {
    return "high";
  }
  if (resolvedOnline) {
    return "medium";
  }
  return metadata.title ? "medium" : "low";
}

// Names the winning route plus how many distinct sources contributed, which is
// what a maintainer reading the log actually wants to know.
function describeOrigin(
  origin: string | undefined,
  fieldSources: Record<string, string>,
  usedOcr: boolean,
): string | undefined {
  const contributors = new Set(Object.values(fieldSources));
  if (contributors.size === 0) {
    return origin;
  }
  const base = origin ?? [...contributors][0] ?? "pdf";
  const suffix = usedOcr ? " +ocr" : "";
  return `${base}${suffix} (${contributors.size} source${contributors.size === 1 ? "" : "s"})`;
}

// Emits a single-key object only when the value is present, keeping optional
// fields absent rather than set to undefined under exactOptionalPropertyTypes.
function optional<K extends string>(key: K, value: string | undefined): Record<K, string> | Record<string, never> {
  return value ? ({ [key]: value } as Record<K, string>) : {};
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
