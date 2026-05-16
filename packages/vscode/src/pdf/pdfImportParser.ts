/**
 * Re-export shim retained for backward compatibility — all symbols have moved to pdf/parser.ts and pdf/types.ts.
 *
 * @depends pdf/parser.ts, pdf/types.ts
 * @dependents none
 */
export { PdfImportParser } from './parser.js';
export type { ParsedPdfImport } from './types.js';
