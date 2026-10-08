/**
 * Regression tests for the PDF byte buffer lifetime.
 *
 * pdfjs takes ownership of the `data` array it is given and detaches it, so a
 * caller that parses a PDF before copying it to disk ends up writing zero
 * bytes — producing a library entry whose viewer fails with "The PDF file is
 * empty, i.e. its size is zero bytes." The import's own guard against a
 * consumed buffer is tested with the core import.
 */

import { NodePdfOpener } from '../../src/pdf/nodePdfOpener';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdfjsMock = require('../../__mocks__/pdfjs-dist-legacy.js');

// Mirrors how pdfjs disposes of the buffer it was handed.
function detach(bytes: Uint8Array): void {
  const buffer = bytes.buffer as ArrayBuffer;
  structuredClone(buffer, { transfer: [buffer] });
}

describe('NodePdfOpener buffer ownership', () => {
  const realGetDocument = pdfjsMock.getDocument;

  afterEach(() => {
    pdfjsMock.getDocument = realGetDocument;
  });

  it('leaves the caller-owned array readable after pdfjs consumes its copy', async () => {
    pdfjsMock.getDocument = jest.fn(({ data }: { data: Uint8Array }) => {
      detach(data);
      return realGetDocument({ data: new Uint8Array(200) });
    });

    const bytes = new Uint8Array(512).fill(7);
    await new NodePdfOpener().open(bytes);

    expect(bytes.byteLength).toBe(512);
    expect(bytes[0]).toBe(7);
  });

  it('hands pdfjs a private copy rather than the caller array', async () => {
    const seen: Uint8Array[] = [];
    pdfjsMock.getDocument = jest.fn(({ data }: { data: Uint8Array }) => {
      seen.push(data);
      return realGetDocument({ data });
    });

    const bytes = new Uint8Array(512).fill(3);
    await new NodePdfOpener().open(bytes);

    expect(seen[0]).not.toBe(bytes);
    expect(Array.from(seen[0]!.slice(0, 4))).toEqual([3, 3, 3, 3]);
  });
});
