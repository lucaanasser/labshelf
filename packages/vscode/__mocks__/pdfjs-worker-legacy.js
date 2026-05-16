/**
 * Mock for pdfjs-dist/legacy/build/pdf.worker.mjs
 *
 * The real worker module uses import.meta.url and cannot load in Jest's CJS
 * mode. PdfImportParser imports it only to register a main-thread worker via
 * globalThis.pdfjsWorker. The mocked pdf.mjs resolves documents directly and
 * never exercises the worker, so a placeholder WorkerMessageHandler suffices.
 */

class WorkerMessageHandler {
  static setup() {}
}

module.exports = {
  WorkerMessageHandler,
  default: { WorkerMessageHandler },
};
