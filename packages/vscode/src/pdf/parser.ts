/**
 * Module: PDF Import Parser
 * Responsibility: Orchestrate PDF.js setup, polyfills, and metadata extraction pipeline
 * Dependencies: vscode workspace filesystem, pdfjs-dist, extractor, resolver, types
 */
import * as path from "node:path";
import * as vscode from "vscode";
import type { ParsedPdfImport } from "./types.js";
import {
  extractTitleBlocks,
  extractFirstPagesText,
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
    let titleBlocks: import("./types.js").TextBlock[] = [];

    try {
      const metadata = await document.getMetadata().catch(() => undefined);
      pdfInfo = (metadata?.info as Record<string, unknown>) ?? {};
      firstPagesText = await extractFirstPagesText(document, 2);
      titleBlocks = await extractTitleBlocks(document).catch(() => []);
    } finally {
      await Promise.resolve(document.destroy()).catch(() => undefined);
    }

    const identifier = detectIdentifier(pdfInfo, firstPagesText);
    const resolved = identifier ? await resolveOnlineMetadata(identifier).catch(() => undefined) : undefined;

    const infoTitle = asString(pdfInfo.Title);
    const infoAuthor = asString(pdfInfo.Author);
    const creationDate = extractYear(asString(pdfInfo.CreationDate) ?? asString(pdfInfo.ModDate));
    const layoutTitle = titleFromBlocks(titleBlocks);

    const title = normalizeTitle(resolved?.title ?? infoTitle ?? layoutTitle ?? fileStem);
    const authorSource = resolved?.authors ?? infoAuthor;
    const authors = authorSource
      ? normalizeAuthors(authorSource)
      : authorsFromBlocks(titleBlocks, layoutTitle);
    const year = resolved?.year ?? creationDate;
    // Use the canonical DOI from metadata or identifier detection
    const doi = resolved?.doi ?? (identifier?.type === "doi" ? identifier.value : asString(pdfInfo.DOI as unknown));
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
}
