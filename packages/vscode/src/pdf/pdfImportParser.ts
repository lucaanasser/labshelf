/**
 * Module: PDF Import Parser
 * Responsibility: Extract usable metadata from scientific paper PDFs
 * Dependencies: vscode workspace filesystem, pdfjs-dist, network lookup for identifiers
 */
import * as path from "node:path";
import * as vscode from "vscode";

export interface ParsedPdfImport {
  title: string;
  citeKey: string;
  year?: number;
  authors: string[];
  // Bibliographic fields returned by CrossRef / arXiv
  journal?: string;
  publisher?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  doi?: string;
  url?: string;
  issn?: string;
  language?: string;
  summary?: string;
}

interface ResolvedMetadata {
  title?: string | undefined;
  authors?: string[] | undefined;
  year?: number | undefined;
  journal?: string | undefined;
  publisher?: string | undefined;
  volume?: string | undefined;
  issue?: string | undefined;
  pages?: string | undefined;
  doi?: string | undefined;
  url?: string | undefined;
  issn?: string | undefined;
  language?: string | undefined;
  summary?: string | undefined;
}

interface DetectedIdentifier {
  type: "doi" | "arxiv";
  value: string;
}

// A run of page-1 text sharing the same font size, in reading order. Used to
// recover the title (largest font near the top) and the author line below it.
interface TextBlock {
  size: number;
  text: string;
}

export class PdfImportParser {
  async parse(sourceUri: vscode.Uri): Promise<ParsedPdfImport> {
    const pdfBytes = await vscode.workspace.fs.readFile(sourceUri);
    const header = Buffer.from(pdfBytes.slice(0, 5)).toString("utf8");

    if (header !== "%PDF-") {
      throw new Error(`File is not a valid PDF: ${sourceUri.fsPath}`);
    }

    const fileStem = path.basename(sourceUri.fsPath, path.extname(sourceUri.fsPath));
    const document = await this.openPdfDocument(pdfBytes);
    let pdfInfo: Record<string, unknown> = {};
    let firstPagesText = "";
    let titleBlocks: TextBlock[] = [];

    try {
      const metadata = await document.getMetadata().catch(() => undefined);
      pdfInfo = (metadata?.info as Record<string, unknown>) ?? {};
      firstPagesText = await this.extractFirstPagesText(document, 2);
      titleBlocks = await this.extractTitleBlocks(document).catch(() => []);
    } finally {
      await Promise.resolve(document.destroy()).catch(() => undefined);
    }

    const identifier = this.detectIdentifier(pdfInfo, firstPagesText);
    const resolved = identifier ? await this.resolveOnlineMetadata(identifier).catch(() => undefined) : undefined;

    const infoTitle = this.asString(pdfInfo.Title);
    const infoAuthor = this.asString(pdfInfo.Author);
    const creationDate = this.extractYear(this.asString(pdfInfo.CreationDate) ?? this.asString(pdfInfo.ModDate));
    const layoutTitle = this.titleFromBlocks(titleBlocks);

    const title = this.normalizeTitle(resolved?.title ?? infoTitle ?? layoutTitle ?? fileStem);
    const authorSource = resolved?.authors ?? infoAuthor;
    const authors = authorSource
      ? this.normalizeAuthors(authorSource)
      : this.authorsFromBlocks(titleBlocks, layoutTitle);
    const year = resolved?.year ?? creationDate;
    // Use the canonical DOI from metadata or identifier detection
    const doi = resolved?.doi ?? (identifier?.type === "doi" ? identifier.value : this.asString(pdfInfo.DOI as unknown));
    const citeKey = this.buildCiteKey(fileStem, title, year, doi ?? identifier?.value);

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

  private async openPdfDocument(pdfBytes: Uint8Array): Promise<any> {
    // DOMMatrix and navigator must exist before pdfjs is first imported — both
    // pdf.mjs and pdf.worker.mjs capture them at module load time.
    this.ensurePdfGlobals();
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    // FeatureTest.platform is a lazy getter that reads navigator.platform/userAgent.
    // In VSCode's extension host navigator may be undefined — pre-cache it safely.
    this.patchPdfjsFeatureTest(pdfjs);
    await this.ensurePdfWorker(pdfjs);
    const loadingTask = pdfjs.getDocument({ data: pdfBytes });
    try {
      return await loadingTask.promise;
    } catch (error) {
      throw this.describePdfError(error);
    }
  }

  // Turns pdfjs' low-level parser errors into a message the user can act on.
  private describePdfError(error: unknown): Error {
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

  private patchPdfjsFeatureTest(pdfjs: Record<string, unknown>): void {
    const FeatureTest = pdfjs["FeatureTest"] as Record<string, unknown> | undefined;
    const shadow = pdfjs["shadow"] as ((obj: object, prop: string, value: unknown) => void) | undefined;
    if (!FeatureTest || !shadow) { return; }

    try {
      void FeatureTest["platform"]; // triggers caching — no-op if navigator is available
    } catch {
      // navigator is undefined in this host — cache platform with safe defaults so
      // pdfjs never tries to read navigator.platform/userAgent again.
      shadow(FeatureTest as object, "platform", {
        isAndroid: false, isLinux: true, isMac: false, isWindows: false, isFirefox: false,
      });
    }
  }

  private ensurePdfGlobals(): void {
    const g = globalThis as Record<string, unknown>;
    this.ensureNavigator(g);
    if (typeof g["DOMMatrix"] !== "undefined") { return; }

    // Minimal DOMMatrix polyfill: pdfjs needs this at module load time.
    // Only the constructor and 2D properties are exercised during text
    // extraction; the method stubs satisfy any rendering paths we don't invoke.
    class DOMMatrix {
      a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
      m11 = 1; m12 = 0; m13 = 0; m14 = 0;
      m21 = 0; m22 = 1; m23 = 0; m24 = 0;
      m31 = 0; m32 = 0; m33 = 1; m34 = 0;
      m41 = 0; m42 = 0; m43 = 0; m44 = 1;
      is2D = true; isIdentity = true;

      constructor(init?: number[] | string) {
        if (Array.isArray(init) && init.length >= 6) {
          this.a = init[0] ?? 1; this.b = init[1] ?? 0;
          this.c = init[2] ?? 0; this.d = init[3] ?? 1;
          this.e = init[4] ?? 0; this.f = init[5] ?? 0;
          this.m11 = this.a; this.m12 = this.b;
          this.m21 = this.c; this.m22 = this.d;
          this.m41 = this.e; this.m42 = this.f;
          this.isIdentity = this.a === 1 && this.b === 0 && this.c === 0
            && this.d === 1 && this.e === 0 && this.f === 0;
        }
      }

      multiply(_other: DOMMatrix): DOMMatrix { return new DOMMatrix(); }
      preMultiplySelf(_other: DOMMatrix): this { return this; }
      multiplySelf(_other: DOMMatrix): this { return this; }
      invertSelf(): this { return this; }
      translate(_tx = 0, _ty = 0): DOMMatrix { return new DOMMatrix(); }
      scale(_sx = 1, _sy = 1): DOMMatrix { return new DOMMatrix(); }
      transformPoint(pt?: { x?: number; y?: number }): { x: number; y: number; z: number; w: number } {
        return { x: pt?.x ?? 0, y: pt?.y ?? 0, z: 0, w: 1 };
      }
    }

    g["DOMMatrix"] = DOMMatrix;
  }

  // pdfjs' FeatureTest reads navigator.platform/userAgent. VSCode's extension
  // host may expose no navigator (or one missing those fields); pdf.worker.mjs
  // captures `globalThis.navigator` at module load and would otherwise throw.
  private ensureNavigator(g: Record<string, unknown>): void {
    const platformByOs: Record<string, string> = {
      linux: "Linux x86_64",
      darwin: "MacIntel",
      win32: "Win32",
    };
    const platform = platformByOs[process.platform] ?? "Linux x86_64";
    const userAgent = `Node.js ${process.version}`;

    const current = g["navigator"] as { platform?: unknown; userAgent?: unknown } | undefined;
    if (current && typeof current === "object") {
      try {
        if (typeof current.platform !== "string") {
          Object.defineProperty(current, "platform", { value: platform, configurable: true });
        }
        if (typeof current.userAgent !== "string") {
          Object.defineProperty(current, "userAgent", { value: userAgent, configurable: true });
        }
      } catch {
        // navigator is read-only in this host — its fields are already populated.
      }
      return;
    }

    try {
      Object.defineProperty(g, "navigator", {
        value: { platform, userAgent, language: "en-US" },
        configurable: true,
      });
    } catch {
      // ignore — patchPdfjsFeatureTest covers pdf.mjs if navigator stays unset.
    }
  }

  // pdfjs always parses through a "worker". In a browser that is a real Web
  // Worker resolved from GlobalWorkerOptions.workerSrc; under Node it auto-loads
  // a main-thread fake worker. VSCode's extension host is neither — there is no
  // Worker constructor and pdfjs' Node detection does not fire — so it throws
  // `No "GlobalWorkerOptions.workerSrc" specified.`. We load the worker module
  // ourselves and expose it as globalThis.pdfjsWorker; pdfjs detects this and
  // runs the parser in-process, with no worker URL required.
  private async ensurePdfWorker(pdfjs: { GlobalWorkerOptions?: { workerSrc?: string } }): Promise<void> {
    const g = globalThis as Record<string, unknown>;
    const existing = g["pdfjsWorker"] as { WorkerMessageHandler?: unknown } | undefined;

    if (!existing?.WorkerMessageHandler) {
      const workerSpecifier = "pdfjs-dist/legacy/build/pdf.worker.mjs";
      const workerModule = (await import(workerSpecifier)) as { WorkerMessageHandler?: unknown };
      g["pdfjsWorker"] = { WorkerMessageHandler: workerModule.WorkerMessageHandler };
    }

    // Defense in depth: keep the workerSrc getter from throwing on any code
    // path that still reads it before the main-thread handler is consulted.
    const globalWorkerOptions = pdfjs.GlobalWorkerOptions;
    if (globalWorkerOptions && !globalWorkerOptions.workerSrc) {
      globalWorkerOptions.workerSrc = "pdfjs-dist/legacy/build/pdf.worker.mjs";
    }
  }

  // Groups page-1 text into runs sharing a font size, in reading order.
  private async extractTitleBlocks(document: any): Promise<TextBlock[]> {
    const page = await document.getPage(1);
    const content = await page.getTextContent();
    const items = content.items as Array<{ str?: string; transform?: number[] }>;

    const blocks: TextBlock[] = [];
    for (const item of items) {
      const str = item.str ?? "";
      if (!str.trim()) { continue; }
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

  // The title is the largest-font run near the top of page 1.
  private titleFromBlocks(blocks: TextBlock[]): string | undefined {
    const head = blocks.slice(0, 8);
    if (head.length === 0) { return undefined; }

    let best = head[0]!;
    for (const block of head) {
      if (block.size > best.size) { best = block; }
    }

    const bodySize = this.medianSize(blocks);
    if (best.size <= bodySize * 1.15) { return undefined; }
    if (best.text.length < 6 || best.text.length > 400) { return undefined; }
    return best.text;
  }

  // Authors usually sit in the run directly below the title.
  private authorsFromBlocks(blocks: TextBlock[], title: string | undefined): string[] {
    if (!title) { return []; }
    const titleIndex = blocks.findIndex((block) => block.text === title);
    if (titleIndex < 0) { return []; }

    for (let i = titleIndex + 1; i < Math.min(blocks.length, titleIndex + 4); i += 1) {
      const candidate = blocks[i]!;
      if (this.looksLikeAuthorLine(candidate.text)) {
        return this.normalizeAuthors(candidate.text);
      }
    }
    return [];
  }

  private looksLikeAuthorLine(text: string): boolean {
    if (text.length < 4 || text.length > 200) { return false; }
    if (/\.\s+[a-z]/.test(text)) { return false; }
    if (/\b(abstract|introduction|university|department|institut|faculty|laborat)/i.test(text)) {
      return false;
    }
    return /[A-ZÀ-Þ][a-zà-ÿ]+/.test(text);
  }

  private medianSize(blocks: TextBlock[]): number {
    if (blocks.length === 0) { return 0; }
    const sizes = blocks.map((block) => block.size).sort((a, b) => a - b);
    return sizes[Math.floor(sizes.length / 2)] ?? 0;
  }

  private async extractFirstPagesText(document: any, pageCount: number): Promise<string> {
    const chunks: string[] = [];
    const limit = Math.min(document.numPages ?? pageCount, pageCount);

    for (let pageNumber = 1; pageNumber <= limit; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const textContent = await page.getTextContent({ normalizeWhitespace: true });
      const pageText = textContent.items
        .map((item: { str?: string }) => item.str ?? "")
        .join(" ")
        .trim();
      if (pageText) {
        chunks.push(pageText);
      }
    }

    return chunks.join("\n");
  }

  private normalizeTitle(rawValue: string): string {
    return rawValue
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  private buildCiteKey(fileStem: string, title: string, year?: number, identifier?: string): string {
    const sourceKey = identifier ?? fileStem ?? title;
    const base = sourceKey
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "")
      .trim();
    return year ? `${base}${year}` : base;
  }

  private detectIdentifier(pdfInfo: Record<string, unknown>, text: string): DetectedIdentifier | undefined {
    const candidate = this.asString(pdfInfo.DOI) ?? this.findDoi(text);
    if (candidate) {
      return { type: "doi", value: candidate };
    }

    const arxivCandidate = this.findArxivId(text);
    if (arxivCandidate) {
      return { type: "arxiv", value: arxivCandidate };
    }

    return undefined;
  }

  private async resolveOnlineMetadata(identifier: DetectedIdentifier): Promise<ResolvedMetadata | undefined> {
    if (identifier.type === "doi") {
      return this.lookupCrossRef(identifier.value);
    }

    if (identifier.type === "arxiv") {
      return this.lookupArxiv(identifier.value);
    }

    return undefined;
  }

  private async lookupCrossRef(doi: string): Promise<ResolvedMetadata | undefined> {
    const response = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, {
      headers: {
        Accept: "application/json",
        "User-Agent": "LabShelf/0.0.1 (VS Code extension; mailto:contact@labshelf.dev)",
      },
    });

    if (!response.ok) {
      return undefined;
    }

    const payload = await response.json() as {
      message?: {
        title?: string[];
        author?: Array<{ given?: string; family?: string }>;
        issued?: { "date-parts"?: number[][] };
        "container-title"?: string[];
        publisher?: string;
        volume?: string;
        issue?: string;
        page?: string;
        DOI?: string;
        URL?: string;
        ISSN?: string[];
        language?: string;
        abstract?: string;
        "short-container-title"?: string[];
      };
    };

    const m = payload.message;
    if (!m) {
      return undefined;
    }

    // CrossRef abstract contains JATS XML markup — strip tags for plain text
    const abstractRaw = m.abstract;
    const abstractText = abstractRaw
      ? abstractRaw.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()
      : undefined;

    return {
      title: this.firstNonEmpty(m.title),
      authors: this.formatAuthorNames(m.author),
      year: this.firstYear(m.issued?.["date-parts"]),
      journal: this.firstNonEmpty(m["container-title"]),
      publisher: m.publisher?.trim() || undefined,
      volume: m.volume?.trim() || undefined,
      issue: m.issue?.trim() || undefined,
      pages: m.page?.trim() || undefined,
      doi: m.DOI?.trim() || undefined,
      url: m.URL?.trim() || undefined,
      issn: m.ISSN?.[0]?.trim() || undefined,
      language: m.language?.trim() || undefined,
      summary: abstractText || undefined,
    };
  }

  private async lookupArxiv(arxivId: string): Promise<ResolvedMetadata | undefined> {
    const response = await fetch(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(arxivId)}`);
    if (!response.ok) {
      return undefined;
    }

    const xml = await response.text();
    const entry = xml.match(/<entry>([\s\S]*?)<\/entry>/)?.[1];
    if (!entry) {
      return undefined;
    }

    const rawAbstract = this.matchXmlTag(entry, "summary");
    const abstractText = rawAbstract ? this.cleanupXmlText(rawAbstract) : undefined;

    return {
      title: this.cleanupXmlText(this.matchXmlTag(entry, "title")),
      authors: [...entry.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>\s*<\/author>/g)]
        .map((match) => this.cleanupXmlText(match[1] ?? ""))
        .filter((author): author is string => typeof author === "string" && author.length > 0),
      year: this.extractYear(this.matchXmlTag(entry, "published") ?? this.matchXmlTag(entry, "updated")),
      journal: "arXiv preprint",
      doi: this.cleanupXmlText(this.matchXmlTag(entry, "id")),
      url: this.cleanupXmlText(this.matchXmlTag(entry, "id")),
      summary: abstractText || undefined,
    };
  }

  private normalizeAuthors(rawValue: string | string[] | undefined): string[] {
    if (Array.isArray(rawValue)) {
      return rawValue.map((value) => value.trim()).filter(Boolean);
    }

    if (!rawValue) {
      return [];
    }

    return rawValue
      .split(/\s+and\s+|;\s*|\s*&\s*/i)
      .map((value) => value.trim())
      .filter(Boolean);
  }

  private findDoi(text: string): string | undefined {
    const match = text.match(/\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+\b/i);
    return match ? this.stripTrailingPunctuation(match[0]) : undefined;
  }

  private findArxivId(text: string): string | undefined {
    const match = text.match(/\b(?:arXiv:\s*)?(\d{4}\.\d{4,5})(?:v\d+)?\b/i);
    return match?.[1];
  }

  private extractYear(rawValue: string | undefined): number | undefined {
    if (!rawValue) {
      return undefined;
    }

    const match = rawValue.match(/(?:(?:19|20)\d{2})/);
    return match ? Number(match[0]) : undefined;
  }

  private asString(value: unknown): string | undefined {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  }

  private matchXmlTag(content: string, tagName: string): string | undefined {
    return content.match(new RegExp(`<${tagName}>([\\s\\S]*?)</${tagName}>`, "i"))?.[1];
  }

  private cleanupXmlText(value: string | undefined): string | undefined {
    return value?.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  }

  private stripTrailingPunctuation(value: string): string {
    return value.replace(/[)\].,;:]+$/g, "");
  }

  private firstNonEmpty(values: string[] | undefined): string | undefined {
    return values?.map((value) => value.trim()).find((value) => value.length > 0);
  }

  private formatAuthorNames(authors: Array<{ given?: string; family?: string }> | undefined): string[] {
    return (authors ?? [])
      .map((author) => [author.given, author.family].filter((part) => typeof part === "string" && part.trim().length > 0).join(" ").trim())
      .filter((author) => author.length > 0);
  }

  private firstYear(dateParts: number[][] | undefined): number | undefined {
    const year = dateParts?.[0]?.[0];
    return typeof year === "number" ? year : undefined;
  }
}
