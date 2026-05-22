/**
 * Node-side PdfDocumentOpener. Loads pdfjs-dist, applies VSCode-specific
 * polyfills (DOMMatrix, navigator), and registers the main-thread worker so
 * pdf.mjs can parse PDFs inside the extension host.
 *
 * @depends pdfjs-dist, @labshelf/core
 * @dependents extension.ts
 */
import type { PdfDocumentLike, PdfDocumentOpener } from "@labshelf/core";

const PLATFORM_BY_OS: Record<string, string> = {
  linux: "Linux x86_64",
  darwin: "MacIntel",
  win32: "Win32",
};

export class NodePdfOpener implements PdfDocumentOpener {
  /**
   * Loads pdfjs and returns a parsed document for the given bytes.
   * @usedBy extension.ts (constructor injection into PdfImportParser)
   * @returns PdfDocumentLike
   */
  async open(pdfBytes: Uint8Array): Promise<PdfDocumentLike> {
    this.ensurePdfGlobals();
    const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as Record<string, unknown>;
    this.patchPdfjsFeatureTest(pdfjs);
    await this.ensurePdfWorker(pdfjs);
    const loadingTask = (pdfjs["getDocument"] as (opts: { data: Uint8Array }) => { promise: Promise<PdfDocumentLike> })({ data: pdfBytes });
    return loadingTask.promise;
  }

  // Caches FeatureTest.platform so pdf.mjs never reads an undefined navigator.
  private patchPdfjsFeatureTest(pdfjs: Record<string, unknown>): void {
    const FeatureTest = pdfjs["FeatureTest"] as Record<string, unknown> | undefined;
    const shadow = pdfjs["shadow"] as ((obj: object, prop: string, value: unknown) => void) | undefined;
    if (!FeatureTest || !shadow) {
      return;
    }

    try {
      void FeatureTest["platform"];
    } catch {
      shadow(FeatureTest as object, "platform", {
        isAndroid: false,
        isLinux: true,
        isMac: false,
        isWindows: false,
        isFirefox: false,
      });
    }
  }

  // Ensures DOMMatrix and navigator globals exist before pdfjs is loaded.
  private ensurePdfGlobals(): void {
    const g = globalThis as Record<string, unknown>;
    this.ensureNavigator(g);
    if (typeof g["DOMMatrix"] !== "undefined") {
      return;
    }
    g["DOMMatrix"] = createDomMatrixShim();
  }

  // pdfjs reads navigator.platform/userAgent at module load — populate them safely under Node.
  private ensureNavigator(g: Record<string, unknown>): void {
    const platform = PLATFORM_BY_OS[process.platform] ?? "Linux x86_64";
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
        // navigator is read-only — its fields are already populated.
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

  // Loads the pdfjs worker module and exposes it on globalThis so pdfjs runs in-process.
  private async ensurePdfWorker(pdfjs: Record<string, unknown>): Promise<void> {
    const g = globalThis as Record<string, unknown>;
    const existing = g["pdfjsWorker"] as { WorkerMessageHandler?: unknown } | undefined;

    if (!existing?.WorkerMessageHandler) {
      const workerSpecifier = "pdfjs-dist/legacy/build/pdf.worker.mjs";
      const workerModule = (await import(workerSpecifier)) as { WorkerMessageHandler?: unknown };
      g["pdfjsWorker"] = { WorkerMessageHandler: workerModule.WorkerMessageHandler };
    }

    const globalWorkerOptions = pdfjs["GlobalWorkerOptions"] as { workerSrc?: string } | undefined;
    if (globalWorkerOptions && !globalWorkerOptions.workerSrc) {
      globalWorkerOptions.workerSrc = "pdfjs-dist/legacy/build/pdf.worker.mjs";
    }
  }
}

// Minimal DOMMatrix shim — pdfjs needs the constructor and 2D fields at module load time.
function createDomMatrixShim(): new (init?: number[] | string) => unknown {
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
        this.isIdentity = this.a === 1 && this.b === 0 && this.c === 0 && this.d === 1 && this.e === 0 && this.f === 0;
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
  return DOMMatrix;
}
