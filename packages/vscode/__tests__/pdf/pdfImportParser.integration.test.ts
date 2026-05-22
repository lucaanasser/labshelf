/**
 * PDF Import Parser Test - Integration Test
 * This test runs the PDF parser against the actual seascapes.pdf file
 * to validate metadata extraction (DOI, authors, year, title).
 */

import { PdfImportParser } from '@labshelf/core';
import { NodePdfOpener } from '../../src/pdf/nodePdfOpener';
import * as path from 'path';
import * as fs from 'fs';

function readBytesAndStem(filePath: string): { bytes: Uint8Array; stem: string } {
  const buf = fs.readFileSync(filePath);
  const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  const stem = path.basename(filePath, path.extname(filePath));
  return { bytes, stem };
}

describe('PdfImportParser - Integration Test with Real PDF', () => {
  let parser: PdfImportParser;
  const projectRoot = path.join(__dirname, '../../');
  const samplePdfPath = path.join(projectRoot, 'seascapes.pdf');

  beforeEach(() => {
    parser = new PdfImportParser(new NodePdfOpener());
  });

  describe('Metadata Extraction from seascapes.pdf', () => {
    it('should successfully parse the seascapes.pdf file', async () => {
      if (!fs.existsSync(samplePdfPath)) {
        console.warn(`Sample PDF not found at ${samplePdfPath}`);
        return;
      }

      const { bytes, stem } = readBytesAndStem(samplePdfPath);
      const header = new TextDecoder('utf-8').decode(bytes.slice(0, 5));
      expect(header).toBe('%PDF-');

      const result = await parser.parse(bytes, stem);

      expect(result.title).toBeTruthy();
      expect(result.citeKey).toBeTruthy();
      expect(Array.isArray(result.authors)).toBe(true);
      expect(/^[a-z0-9]+$/.test(result.citeKey)).toBe(true);
    }, 60000);

    it('should extract publication year correctly', async () => {
      if (!fs.existsSync(samplePdfPath)) {
        console.warn(`Sample PDF not found at ${samplePdfPath}`);
        return;
      }

      const { bytes, stem } = readBytesAndStem(samplePdfPath);
      const result = await parser.parse(bytes, stem);

      if (result.year) {
        expect(result.year).toBeGreaterThanOrEqual(1900);
        expect(result.year).toBeLessThanOrEqual(new Date().getFullYear());
      }
    }, 30000);

    it('should generate consistent cite key', async () => {
      if (!fs.existsSync(samplePdfPath)) {
        console.warn(`Sample PDF not found at ${samplePdfPath}`);
        return;
      }

      const { bytes, stem } = readBytesAndStem(samplePdfPath);
      const result1 = await parser.parse(bytes, stem);
      const result2 = await parser.parse(bytes, stem);

      expect(result1.citeKey).toBe(result2.citeKey);
    }, 60000);
  });

  describe('Error Handling', () => {
    it('should reject non-PDF bytes', async () => {
      const bytes = new TextEncoder().encode('{"name": "package.json"}');
      await expect(parser.parse(bytes, 'package')).rejects.toThrow();
    });
  });
});
