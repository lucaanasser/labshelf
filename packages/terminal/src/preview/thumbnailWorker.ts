/**
 * Worker thread that renders page 1 of a PDF to PNG with pdfjs and the native canvas, used when poppler's pdftoppm is
 * not installed. Rendering runs off the main thread so the TUI keeps responding while a large PDF is drawn.
 *
 * Message in: { pdfPath, widthPx }. Message out: { png: Uint8Array } or { error: string }.
 *
 * @depends pdfjs-dist, @napi-rs/canvas, platform/nodePdfOpener
 * @dependents preview/thumbnails (spawned as dist/thumbnailWorker.mjs)
 */
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { parentPort, workerData } from "node:worker_threads";

import { loadPdfjs, pdfjsDataOptions } from "../platform/nodePdfOpener.js";

interface CanvasModule {
  createCanvas(width: number, height: number): {
    width: number;
    height: number;
    getContext(kind: "2d"): { fillStyle: string; fillRect(x: number, y: number, w: number, h: number): void };
    toBuffer(mime: "image/png"): Buffer;
  };
}

// The canvas pdfjs itself depends on: two copies of the native Skia binding in one process crash it.
function loadCanvas(): CanvasModule {
  const pdfjsPackage = require.resolve("pdfjs-dist/package.json");
  const canvas = createRequire(pdfjsPackage)("@napi-rs/canvas") as CanvasModule & Record<string, unknown>;
  const globals = globalThis as Record<string, unknown>;
  for (const name of ["Path2D", "DOMMatrix", "ImageData", "DOMPoint"]) {
    if (canvas[name] && !globals[name]) { globals[name] = canvas[name]; }
  }
  return canvas;
}

async function render(pdfPath: string, widthPx: number): Promise<Uint8Array> {
  const canvasModule = loadCanvas();
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({ data: new Uint8Array(await readFile(pdfPath)), verbosity: 0, ...pdfjsDataOptions() });
  try {
    const document = (await task.promise) as unknown as {
      getPage(n: number): Promise<{
        getViewport(o: { scale: number }): { width: number; height: number };
        render(o: Record<string, unknown>): { promise: Promise<void> };
      }>;
    };
    const page = await document.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: widthPx / base.width });
    const canvas = canvasModule.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext("2d");
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: context, viewport, canvas }).promise;
    return new Uint8Array(canvas.toBuffer("image/png"));
  } finally {
    await task.destroy().catch(() => undefined);
  }
}

const { pdfPath, widthPx } = workerData as { pdfPath: string; widthPx: number };
render(pdfPath, widthPx).then(
  (png) => parentPort?.postMessage({ png }, [png.buffer as ArrayBuffer]),
  (error: unknown) => parentPort?.postMessage({ error: error instanceof Error ? error.message : String(error) }),
);
