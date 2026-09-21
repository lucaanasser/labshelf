/**
 * Makes pdfjs behave as a Node library inside the VS Code extension host.
 *
 * pdfjs decides at import time whether it runs under Node, and an Electron
 * utility process — which is what the extension host is — fails that test. It
 * then assumes a browser: canvases come from `document.createElement`, fonts
 * from `document.fonts`, and CMaps and standard fonts from `fetch()` of what is
 * really a filesystem path. None of that exists here, so rendering throws and
 * text drawn with CID or non-embedded fonts extracts as blanks. Every one of
 * those choices can be overridden per document, which is what this module does.
 *
 * @depends pdfjs-dist, @napi-rs/canvas
 * @dependents pdf/nodePdfOpener.ts, pdf/tesseractOcrEngine.ts
 */
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import * as path from "node:path";

export interface RenderCanvas {
  width: number;
  height: number;
  getContext(kind: "2d", options?: Record<string, unknown>): CanvasContext;
  toBuffer(mime: "image/png"): Buffer;
}

export interface CanvasContext {
  fillStyle: string;
  fillRect(x: number, y: number, width: number, height: number): void;
}

export interface CanvasModule {
  createCanvas(width: number, height: number): RenderCanvas;
}

let canvasModule: CanvasModule | null | undefined;

/**
 * Loads the native canvas pdfjs draws on, and installs its geometry classes as
 * globals: pdfjs builds Path2D, DOMMatrix and ImageData from globals and hands
 * them to the canvas context, which rejects any implementation but its own.
 *
 * The copy pdfjs-dist itself depends on is preferred. Two versions of the
 * native Skia binding in one process exchange incompatible objects and crash
 * the host with a segmentation fault rather than an exception.
 * @usedBy pdf/tesseractOcrEngine.ts
 * @returns The canvas module, or undefined when no native build is installed.
 */
export function loadPdfCanvas(): CanvasModule | undefined {
  if (canvasModule !== undefined) {
    return canvasModule ?? undefined;
  }

  canvasModule = null;
  for (const resolveFrom of [pdfjsPackageJson(), __filename]) {
    if (!resolveFrom) {
      continue;
    }
    try {
      const loaded = createRequire(resolveFrom)("@napi-rs/canvas") as CanvasModule & Record<string, unknown>;
      const globals = globalThis as Record<string, unknown>;
      for (const name of ["Path2D", "DOMMatrix", "ImageData", "DOMPoint"]) {
        if (loaded[name]) {
          globals[name] = loaded[name];
        }
      }
      canvasModule = loaded;
      break;
    } catch {
      // Not installed next to this resolution root — try the next one.
    }
  }
  return canvasModule ?? undefined;
}

/**
 * getDocument options that read CMaps and standard fonts from disk. Needed for
 * text extraction alone; safe to pass whether or not pdfjs detected Node.
 * @usedBy pdf/nodePdfOpener.ts, pdf/tesseractOcrEngine.ts
 * @returns Options to spread into pdfjs' getDocument call.
 */
export function nodeDataOptions(): Record<string, unknown> {
  const packageJson = pdfjsPackageJson();
  if (!packageJson) {
    return {};
  }
  const packageRoot = path.dirname(packageJson);
  return {
    cMapUrl: `${path.join(packageRoot, "cmaps")}${path.sep}`,
    cMapPacked: true,
    standardFontDataUrl: `${path.join(packageRoot, "standard_fonts")}${path.sep}`,
    wasmUrl: `${path.join(packageRoot, "wasm")}${path.sep}`,
    BinaryDataFactory: DiskBinaryDataFactory,
    // The worker would otherwise fetch() these paths itself.
    useWorkerFetch: false,
  };
}

/**
 * getDocument options for rasterizing pages onto the given native canvas.
 * @usedBy pdf/tesseractOcrEngine.ts
 * @returns Options to spread into pdfjs' getDocument call.
 */
export function nodeRenderOptions(canvas: CanvasModule): Record<string, unknown> {
  return {
    ...nodeDataOptions(),
    CanvasFactory: canvasFactoryFor(canvas),
    FilterFactory: NoopFilterFactory,
    isOffscreenCanvasSupported: false,
    isImageDecoderSupported: false,
    // Without a DOM there is no FontFace; glyphs are drawn as paths instead.
    disableFontFace: true,
    useSystemFonts: false,
  };
}

function pdfjsPackageJson(): string | undefined {
  try {
    return require.resolve("pdfjs-dist/package.json");
  } catch {
    return undefined;
  }
}

// Mirrors pdfjs' BaseBinaryDataFactory, which it does not export.
class DiskBinaryDataFactory {
  private readonly roots: Record<string, string | null>;

  constructor(options: { cMapUrl?: string | null; standardFontDataUrl?: string | null; wasmUrl?: string | null }) {
    this.roots = {
      cMapUrl: options.cMapUrl ?? null,
      standardFontDataUrl: options.standardFontDataUrl ?? null,
      wasmUrl: options.wasmUrl ?? null,
    };
  }

  async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
    const root = this.roots[kind];
    if (!root) {
      throw new Error(`Ensure that the \`${kind}\` API parameter is provided.`);
    }
    return new Uint8Array(await readFile(`${root}${filename}`));
  }
}

// Mirrors pdfjs' BaseFilterFactory: SVG filters need a DOM, so none are applied.
class NoopFilterFactory {
  addFilter(): string { return "none"; }
  addHCMFilter(): string { return "none"; }
  addAlphaFilter(): string { return "none"; }
  addLuminosityFilter(): string { return "none"; }
  addHighlightHCMFilter(): string { return "none"; }
  destroy(): void {}
}

interface CanvasAndContext {
  canvas: RenderCanvas | null;
  context: CanvasContext | null;
}

// Mirrors pdfjs' BaseCanvasFactory over the given native canvas module.
function canvasFactoryFor(canvasPkg: CanvasModule): new (options?: Record<string, unknown>) => unknown {
  return class NativeCanvasFactory {
    create(width: number, height: number): CanvasAndContext {
      if (width <= 0 || height <= 0) {
        throw new Error("Invalid canvas size");
      }
      const canvas = canvasPkg.createCanvas(width, height);
      return { canvas, context: canvas.getContext("2d") };
    }

    reset(target: CanvasAndContext, width: number, height: number): void {
      if (!target.canvas) {
        throw new Error("Canvas is not specified");
      }
      if (width <= 0 || height <= 0) {
        throw new Error("Invalid canvas size");
      }
      target.canvas.width = width;
      target.canvas.height = height;
    }

    destroy(target: CanvasAndContext): void {
      if (!target.canvas) {
        throw new Error("Canvas is not specified");
      }
      target.canvas.width = target.canvas.height = 0;
      target.canvas = null;
      target.context = null;
    }
  };
}
