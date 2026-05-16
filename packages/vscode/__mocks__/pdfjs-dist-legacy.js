/**
 * Mock for pdfjs-dist/legacy/build/pdf.mjs
 *
 * pdfjs-dist uses import.meta.url internally, which is ESM-only and
 * incompatible with Jest running in CJS mode. This mock replaces the
 * real module for all test runs and provides enough of the API for
 * PdfImportParser unit and integration tests to exercise parser logic
 * without loading the native PDF engine.
 *
 * Behaviour:
 *   - data < 100 bytes  → rejects (exercises the corrupted-PDF test path)
 *   - data >= 100 bytes → resolves with a mock document
 */

const GlobalWorkerOptions = {};

function makeDocument() {
  return {
    numPages: 2,
    getMetadata: function () {
      return Promise.resolve({
        info: {
          Title: 'Mock PDF Title From pdfjs',
          Author: 'Mock Author',
          CreationDate: 'D:20240101120000',
        },
      });
    },
    getPage: function (_pageNum) {
      return Promise.resolve({
        getTextContent: function () {
          return Promise.resolve({
            items: [{ str: 'Mock page text used for metadata extraction in tests' }],
          });
        },
      });
    },
    destroy: function () {
      return Promise.resolve();
    },
  };
}

function getDocument({ data }) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data || []);

  if (bytes.length < 100) {
    return { promise: Promise.reject(new Error('Invalid or corrupted PDF: file too small')) };
  }

  return { promise: Promise.resolve(makeDocument()) };
}

module.exports = {
  GlobalWorkerOptions,
  getDocument,
  // Named export alias used by some pdfjs versions
  default: { GlobalWorkerOptions, getDocument },
};
