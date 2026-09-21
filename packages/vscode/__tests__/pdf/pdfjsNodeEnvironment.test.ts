/**
 * Unit tests for the options that make pdfjs act as a Node library inside the
 * extension host, where it would otherwise assume a browser and reach for a
 * DOM canvas and fetch() of filesystem paths.
 */

import * as fs from 'node:fs';

import { nodeDataOptions, nodeRenderOptions } from '../../src/pdf/pdfjsNodeEnvironment';
import type { CanvasModule } from '../../src/pdf/pdfjsNodeEnvironment';

interface BinaryDataFactory {
  fetch(request: { kind: string; filename: string }): Promise<Uint8Array>;
}

describe('nodeDataOptions', () => {
  it('points at the CMap and standard-font tables shipped with pdfjs-dist', () => {
    const options = nodeDataOptions();

    expect(fs.existsSync(options['cMapUrl'] as string)).toBe(true);
    expect(fs.existsSync(options['standardFontDataUrl'] as string)).toBe(true);
    expect(options['useWorkerFetch']).toBe(false);
  });

  it('reads binary data from disk rather than over fetch()', async () => {
    const options = nodeDataOptions();
    const Factory = options['BinaryDataFactory'] as new (o: Record<string, unknown>) => BinaryDataFactory;
    const factory = new Factory({ cMapUrl: options['cMapUrl'] });

    const filename = fs.readdirSync(options['cMapUrl'] as string).find((name) => name.endsWith('.bcmap'))!;
    const data = await factory.fetch({ kind: 'cMapUrl', filename });
    expect(data.byteLength).toBeGreaterThan(0);

    await expect(factory.fetch({ kind: 'wasmUrl', filename: 'jbig2.wasm' })).rejects.toThrow(/wasmUrl/);
  });
});

describe('nodeRenderOptions', () => {
  const context = { fillStyle: '', fillRect: jest.fn() };
  const canvasModule: CanvasModule = {
    createCanvas: jest.fn((width: number, height: number) => ({
      width,
      height,
      getContext: () => context,
      toBuffer: () => Buffer.alloc(0),
    })),
  };

  it('draws on the native canvas and never on a DOM one', () => {
    const options = nodeRenderOptions(canvasModule);
    const Factory = options['CanvasFactory'] as new () => {
      create(w: number, h: number): { canvas: { width: number } | null; context: unknown };
      destroy(target: { canvas: unknown; context: unknown }): void;
    };
    const factory = new Factory();

    const target = factory.create(20, 10);
    expect(canvasModule.createCanvas).toHaveBeenCalledWith(20, 10);
    expect(target.context).toBe(context);

    factory.destroy(target);
    expect(target.canvas).toBeNull();
    expect(() => factory.create(0, 10)).toThrow('Invalid canvas size');
  });

  it('turns off every browser-only rendering path', () => {
    const options = nodeRenderOptions(canvasModule);

    expect(options['disableFontFace']).toBe(true);
    expect(options['isOffscreenCanvasSupported']).toBe(false);
    expect(options['isImageDecoderSupported']).toBe(false);
    expect(options['useSystemFonts']).toBe(false);
  });
});
