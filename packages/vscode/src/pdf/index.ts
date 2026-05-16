/**
 * Public barrel export for the pdf/ module — exposes PdfImportParser and the ParsedPdfImport type.
 *
 * @depends pdf/parser.ts, pdf/types.ts
 * @dependents core/paperService.ts, extension.ts
 */
export { PdfImportParser } from './parser.js';
export type { ParsedPdfImport } from './types.js';
