/**
 * Unit tests for giving scanned PDFs a text layer: which documents qualify,
 * how the layer is laid over the original pages, and the checks that keep a
 * paper from being replaced by something worse. OCR and rendering are faked;
 * the PDFs are real and written with pdf-lib.
 */

import { PDFDocument, StandardFonts } from 'pdf-lib';

import { SearchablePdfBuilder } from '../../src/pdf/searchablePdfBuilder';
import { openPdfForOcr } from '../../src/pdf/tesseractOcrEngine';
import type { OcrDocument, TesseractOcrEngine } from '../../src/pdf/tesseractOcrEngine';

jest.mock('../../src/pdf/tesseractOcrEngine', () => ({ openPdfForOcr: jest.fn() }));

const PAGE_OF_TEXT = 'The quick brown fox jumps over the lazy dog. '.repeat(12);

async function blankPdf(pageCount: number, rotateFirst = false): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  for (let i = 0; i < pageCount; i += 1) {
    pdf.addPage([400, 600]);
  }
  if (rotateFirst) {
    const { degrees } = await import('pdf-lib');
    pdf.getPage(0).setRotation(degrees(90));
  }
  return pdf.save();
}

// What Tesseract hands back for a page: a one-page PDF holding only text.
async function textLayer(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([1000, 1500]);
  page.drawText('recognised words', { x: 50, y: 700, size: 24, font: await pdf.embedFont(StandardFonts.Helvetica) });
  return pdf.save();
}

function ocrDocument(pageTexts: string[], rotations: number[] = [], invisible: Array<number | undefined> = []): OcrDocument {
  return {
    numPages: pageTexts.length,
    pageText: jest.fn(async (n: number) => pageTexts[n - 1] ?? ''),
    rotation: jest.fn(async (n: number) => rotations[n - 1] ?? 0),
    // Pages with text draw it visibly unless told otherwise.
    invisibleTextShare: jest.fn(async (n: number) => (n - 1 in invisible ? invisible[n - 1] : pageTexts[n - 1] ? 0 : undefined)),
    renderPng: jest.fn(async () => Buffer.from('png')),
    close: jest.fn(async () => undefined),
  };
}

function engineReturning(layer: Uint8Array | undefined): TesseractOcrEngine {
  return { recognizeTextLayer: jest.fn(async () => layer), report: jest.fn() } as unknown as TesseractOcrEngine;
}

// First open reads the source; the second is the verification of the result.
function openSequence(...documents: Array<OcrDocument | undefined>): void {
  const mock = openPdfForOcr as jest.Mock;
  mock.mockReset();
  documents.forEach((document) => mock.mockResolvedValueOnce(document));
}

describe('SearchablePdfBuilder', () => {
  it('lays a text layer over every page of a scan and reports progress', async () => {
    openSequence(ocrDocument(['', '']), ocrDocument([PAGE_OF_TEXT, PAGE_OF_TEXT]));
    const engine = engineReturning(await textLayer());
    const steps: number[] = [];

    const outcome = await new SearchablePdfBuilder(engine).build(await blankPdf(2), {
      onProgress: (step) => steps.push(step.pageNumber),
    });

    expect(outcome).toMatchObject({ status: 'added', pagesAdded: 2, pagesFailed: 0 });
    expect(steps).toEqual([1, 2]);
    // The original pages survive, each now drawing the embedded layer.
    const result = await PDFDocument.load((outcome as { bytes: Uint8Array }).bytes);
    expect(result.getPageCount()).toBe(2);
    expect(result.getPage(0).getSize()).toEqual({ width: 400, height: 600 });
    expect(result.getPage(0).node.Resources()?.toString()).toContain('XObject');
  });

  it('leaves a born-digital paper alone even when one page is all figure', async () => {
    openSequence(ocrDocument([PAGE_OF_TEXT, '', PAGE_OF_TEXT]));
    const engine = engineReturning(await textLayer());

    expect(await new SearchablePdfBuilder(engine).build(await blankPdf(3))).toEqual({ status: 'not-needed', layer: 'native' });
    expect(engine.recognizeTextLayer).not.toHaveBeenCalled();
  });

  it('recognises a scan that some OCR tool already read', async () => {
    // Page 1 is a figure; page 2 has mostly invisible text with a visible stamp.
    openSequence(ocrDocument([PAGE_OF_TEXT, PAGE_OF_TEXT, PAGE_OF_TEXT], [], [undefined, 0.84, 0]));
    const engine = engineReturning(await textLayer());

    expect(await new SearchablePdfBuilder(engine).build(await blankPdf(3))).toEqual({ status: 'not-needed', layer: 'ocr' });
    expect(engine.recognizeTextLayer).not.toHaveBeenCalled();
  });

  it('treats a stamp repeated on every page as no text layer', async () => {
    const stamp = 'Downloaded 12/25/12 to 150.135.135.70. Redistribution subject to SIAM license or copyright';
    openSequence(ocrDocument([stamp, stamp]), ocrDocument([PAGE_OF_TEXT, PAGE_OF_TEXT]));

    const outcome = await new SearchablePdfBuilder(engineReturning(await textLayer())).build(await blankPdf(2));
    expect(outcome.status).toBe('added');
  });

  it('refuses documents above the page limit', async () => {
    openSequence(ocrDocument(['', '', '']));

    const outcome = await new SearchablePdfBuilder(engineReturning(await textLayer()), { maxPages: 2 }).build(await blankPdf(3));
    expect(outcome).toEqual({ status: 'skipped', reason: '3 pages need OCR, above the limit of 2 (labshelf.ocr.maxPages)' });
  });

  it('classifies but never reads when OCR is turned off', async () => {
    openSequence(ocrDocument(['', '']));

    expect(await new SearchablePdfBuilder(undefined).build(await blankPdf(2))).toEqual({
      status: 'skipped',
      reason: 'OCR is turned off in settings (labshelf.ocr.enabled)',
    });
    openSequence(ocrDocument([PAGE_OF_TEXT, PAGE_OF_TEXT]));
    expect(await new SearchablePdfBuilder(undefined).build(await blankPdf(2))).toEqual({ status: 'not-needed', layer: 'native' });
  });

  it('skips rotated pages and counts them as failed', async () => {
    openSequence(ocrDocument(['', ''], [90, 0]), ocrDocument(['', PAGE_OF_TEXT]));

    const outcome = await new SearchablePdfBuilder(engineReturning(await textLayer())).build(await blankPdf(2, true));
    expect(outcome).toMatchObject({ status: 'added', pagesAdded: 1, pagesFailed: 1 });
  });

  it('stops without a result when cancelled', async () => {
    openSequence(ocrDocument(['', '']));
    const engine = engineReturning(await textLayer());

    expect(await new SearchablePdfBuilder(engine).build(await blankPdf(2), { isCancelled: () => true })).toEqual({ status: 'cancelled' });
    expect(engine.recognizeTextLayer).not.toHaveBeenCalled();
  });

  it('returns nothing to write when OCR finds no text, the result fails verification, or no canvas exists', async () => {
    openSequence(ocrDocument(['']));
    expect(await new SearchablePdfBuilder(engineReturning(undefined)).build(await blankPdf(1))).toMatchObject({
      status: 'unavailable',
      reason: 'OCR found no text on any page',
    });

    // Verification re-opens the result and still finds the page empty.
    openSequence(ocrDocument(['']), ocrDocument(['']));
    expect(await new SearchablePdfBuilder(engineReturning(await textLayer())).build(await blankPdf(1))).toMatchObject({
      status: 'unavailable',
      reason: 'the rewritten PDF did not pass verification',
    });

    openSequence(undefined);
    expect((await new SearchablePdfBuilder(engineReturning(undefined)).build(await blankPdf(1))).status).toBe('unavailable');
  });

  it('explains an encrypted PDF in plain words', async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([400, 600]);
    const bytes = await pdf.save();
    jest.spyOn(PDFDocument, 'load').mockRejectedValueOnce(
      new Error('Input document to `PDFDocument.load` is encrypted. You can use `PDFDocument.load(..., { ignoreEncryption: true })`'),
    );
    openSequence(ocrDocument(['']));

    expect(await new SearchablePdfBuilder(engineReturning(await textLayer())).build(bytes)).toEqual({
      status: 'unavailable',
      reason: 'the PDF is encrypted by its publisher, so text cannot be added to it',
    });
  });

  it('leaves an unreadable PDF untouched', async () => {
    openSequence(ocrDocument(['']));

    const outcome = await new SearchablePdfBuilder(engineReturning(await textLayer())).build(new Uint8Array([1, 2, 3]));
    expect(outcome.status).toBe('unavailable');
  });
});

describe('SearchablePdfBuilder.detect', () => {
  it('tells a scan from a born-digital paper without any OCR', async () => {
    const engine = engineReturning(await textLayer());
    const builder = new SearchablePdfBuilder(engine);

    openSequence(ocrDocument(['', '', PAGE_OF_TEXT]));
    expect(await builder.detect(new Uint8Array())).toEqual({ status: 'missing', textlessPages: 2, totalPages: 3 });

    openSequence(ocrDocument([PAGE_OF_TEXT, '', PAGE_OF_TEXT]));
    expect(await builder.detect(new Uint8Array())).toEqual({ status: 'native' });

    openSequence(ocrDocument([PAGE_OF_TEXT, PAGE_OF_TEXT], [], [0.96]));
    expect(await builder.detect(new Uint8Array())).toEqual({ status: 'ocr' });

    expect(engine.recognizeTextLayer).not.toHaveBeenCalled();
  });

  it('closes the document and reports a PDF that cannot be opened', async () => {
    const document = ocrDocument(['']);
    openSequence(document);
    await new SearchablePdfBuilder(undefined).detect(new Uint8Array());
    expect(document.close).toHaveBeenCalled();

    openSequence(undefined);
    expect(await new SearchablePdfBuilder(undefined).detect(new Uint8Array())).toMatchObject({ status: 'unavailable' });
  });
});
