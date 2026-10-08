/**
 * First-page thumbnails for the preview pane. Rendered once per PDF version and cached on disk (keyed by path, size
 * and mtime) in the user cache directory — never inside the library, which is synced. Rendering prefers poppler's
 * pdftoppm (fast, what yazi uses) and falls back to pdfjs in a worker thread. Only the most recent request matters:
 * while the user scrolls, requests that were overtaken are dropped before they start.
 *
 * @depends platform/system (hasCommand), preview/thumbnailWorker
 * @dependents app/context, ui/app
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { Worker } from "node:worker_threads";

import type { ILogger } from "@labshelf/core";

import { hasCommand } from "../platform/system.js";

export interface ThumbnailRequest {
  pdfPath: string;
  sizeBytes: number;
  mtimeMs: number;
}

export type Renderer = (pdfPath: string, widthPx: number) => Promise<Uint8Array>;

const WIDTH_PX = 720;
const MEMORY_ENTRIES = 24;
const RENDER_TIMEOUT_MS = 20_000;

/**
 * Renders with pdftoppm into a temporary prefix.
 * @usedBy defaultRenderer
 * @returns the PNG bytes
 */
export function renderWithPdftoppm(tmpDir: string): Renderer {
  return async (pdfPath, widthPx) => {
    await fs.mkdir(tmpDir, { recursive: true });
    const prefix = path.join(tmpDir, `thumb-${process.pid}-${Date.now()}`);
    await new Promise<void>((resolve, reject) => {
      const child = spawn("pdftoppm", ["-png", "-f", "1", "-l", "1", "-scale-to-x", String(widthPx), "-scale-to-y", "-1", "-singlefile", pdfPath, prefix], {
        stdio: "ignore",
      });
      const timer = setTimeout(() => { child.kill(); reject(new Error("pdftoppm timed out")); }, RENDER_TIMEOUT_MS);
      child.on("error", (error) => { clearTimeout(timer); reject(error); });
      child.on("close", (code) => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`pdftoppm exited with ${code}`)); });
    });
    try {
      return new Uint8Array(await fs.readFile(`${prefix}.png`));
    } finally {
      await fs.rm(`${prefix}.png`, { force: true }).catch(() => undefined);
    }
  };
}

/**
 * Renders with pdfjs in a one-shot worker thread.
 * @usedBy defaultRenderer
 * @returns the PNG bytes
 */
export function renderWithWorker(workerUrl: URL): Renderer {
  return (pdfPath, widthPx) => new Promise((resolve, reject) => {
    const worker = new Worker(workerUrl, { workerData: { pdfPath, widthPx } });
    const timer = setTimeout(() => { void worker.terminate(); reject(new Error("Rendering timed out")); }, RENDER_TIMEOUT_MS);
    worker.once("message", (message: { png?: Uint8Array; error?: string }) => {
      clearTimeout(timer);
      void worker.terminate();
      if (message.png) { resolve(new Uint8Array(message.png)); } else { reject(new Error(message.error ?? "render failed")); }
    });
    worker.once("error", (error) => { clearTimeout(timer); reject(error); });
  });
}

/**
 * pdftoppm when installed, otherwise the pdfjs worker.
 * @usedBy app/context
 * @returns the renderer and its name (for doctor)
 */
export function defaultRenderer(tmpDir: string, workerUrl: URL): { name: string; render: Renderer } {
  return hasCommand("pdftoppm")
    ? { name: "pdftoppm", render: renderWithPdftoppm(tmpDir) }
    : { name: "pdfjs", render: renderWithWorker(workerUrl) };
}

export class ThumbnailService {
  private readonly memory = new Map<string, Uint8Array>();
  private readonly failed = new Set<string>();
  private generation = 0;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly cacheDir: string,
    private readonly render: Renderer,
    private readonly logger?: ILogger,
  ) {}

  private key(request: ThumbnailRequest): string {
    return createHash("sha1").update(`${request.pdfPath}\0${request.sizeBytes}\0${Math.round(request.mtimeMs)}\0${WIDTH_PX}`).digest("hex");
  }

  /**
   * The cached thumbnail, if it was rendered before (memory only; cheap enough to call on every frame).
   * @usedBy ui/app
   * @returns PNG bytes or undefined
   */
  peek(request: ThumbnailRequest): Uint8Array | undefined {
    return this.memory.get(this.key(request));
  }

  /**
   * Returns the thumbnail from memory, disk or a fresh render. A request overtaken by a newer one resolves undefined
   * without rendering.
   * @usedBy ui/app
   * @returns PNG bytes, or undefined (overtaken, or the PDF cannot be rendered)
   */
  async get(request: ThumbnailRequest): Promise<Uint8Array | undefined> {
    const key = this.key(request);
    const cached = this.memory.get(key);
    if (cached) { return cached; }
    if (this.failed.has(key)) { return undefined; }
    const ticket = ++this.generation;
    const run = this.chain.then(async () => {
      if (ticket !== this.generation) { return undefined; }
      const file = path.join(this.cacheDir, "thumbs", `${key}.png`);
      let png: Uint8Array | undefined;
      try {
        png = new Uint8Array(await fs.readFile(file));
      } catch {
        try {
          png = await this.render(request.pdfPath, WIDTH_PX);
          await fs.mkdir(path.dirname(file), { recursive: true });
          await fs.writeFile(file, png);
        } catch (error) {
          this.failed.add(key);
          await this.logger?.log("WARN", "terminal/thumbnails", "Thumbnail render failed", {
            pdfPath: request.pdfPath, message: error instanceof Error ? error.message : String(error),
          });
          return undefined;
        }
      }
      this.remember(key, png);
      return png;
    });
    this.chain = run.catch(() => undefined);
    return run;
  }

  private remember(key: string, png: Uint8Array): void {
    this.memory.delete(key);
    this.memory.set(key, png);
    while (this.memory.size > MEMORY_ENTRIES) {
      const oldest = this.memory.keys().next().value as string;
      this.memory.delete(oldest);
    }
  }
}
