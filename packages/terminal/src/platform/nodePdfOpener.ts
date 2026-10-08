/**
 * pdfjs for a plain Node process (the VS Code extension host needs the heavier shims in packages/vscode/src/pdf/,
 * because Electron fails pdfjs' Node detection; plain Node passes it). Loads the legacy build lazily — only importing
 * a PDF or rendering a thumbnail pays for it — runs the worker in-process, and points CMaps, standard fonts and wasm
 * at the files shipped with pdfjs-dist so text in CID and non-embedded fonts extracts correctly.
 */
import * as path from "node:path";

import type { PdfDocumentLike, PdfDocumentOpener } from "@labshelf/core";

type PdfjsModule = Record<string, unknown> & {
  getDocument(options: Record<string, unknown>): { promise: Promise<PdfDocumentLike>; destroy(): Promise<void> };
};

let loading: Promise<PdfjsModule> | undefined;

/**
 * getDocument options that read pdfjs' data files from disk.
 * @returns options to spread into getDocument
 */
export function pdfjsDataOptions(): Record<string, unknown> {
  try {
    // `require` is the CommonJS one under jest and the createRequire shim the esbuild banner defines in the bundle.
    const root = path.dirname(require.resolve("pdfjs-dist/package.json"));
    return {
      cMapUrl: path.join(root, "cmaps") + path.sep,
      cMapPacked: true,
      standardFontDataUrl: path.join(root, "standard_fonts") + path.sep,
      wasmUrl: path.join(root, "wasm") + path.sep,
      useWorkerFetch: false,
      isEvalSupported: false,
    };
  } catch {
    return { isEvalSupported: false };
  }
}

/**
 * Imports pdfjs once, with its worker registered in-process.
 * @returns the pdfjs module
 */
export function loadPdfjs(): Promise<PdfjsModule> {
  loading ??= (async () => {
    const globals = globalThis as Record<string, unknown>;
    if (!(globals["pdfjsWorker"] as { WorkerMessageHandler?: unknown } | undefined)?.WorkerMessageHandler) {
      // pdfjs-dist ships no types for the worker entry; a variable specifier keeps tsc from looking for them.
      const workerSpecifier = "pdfjs-dist/legacy/build/pdf.worker.mjs";
      const worker = (await import(workerSpecifier)) as { WorkerMessageHandler?: unknown };
      globals["pdfjsWorker"] = { WorkerMessageHandler: worker.WorkerMessageHandler };
    }
    const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as PdfjsModule;
    const options = pdfjs["GlobalWorkerOptions"] as { workerSrc?: string } | undefined;
    if (options && !options.workerSrc) { options.workerSrc = "pdfjs-dist/legacy/build/pdf.worker.mjs"; }
    return pdfjs;
  })();
  return loading;
}

/** PdfDocumentOpener for the core PdfImportParser. */
export class NodePdfOpener implements PdfDocumentOpener {
  async open(pdfBytes: Uint8Array): Promise<PdfDocumentLike> {
    const pdfjs = await loadPdfjs();
    // pdfjs detaches the buffer it is given; hand it a copy so the caller can still write the bytes to disk.
    const task = pdfjs.getDocument({ data: new Uint8Array(pdfBytes), verbosity: 0, ...pdfjsDataOptions() });
    const document = await task.promise;
    if (typeof (document as Partial<PdfDocumentLike>).destroy !== "function") {
      document.destroy = () => task.destroy();
    }
    return document;
  }
}
