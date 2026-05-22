import { PdfImportParser } from '@labshelf/core';
import { NodePdfOpener } from '../../src/pdf/nodePdfOpener';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

function readBytesAndStem(filePath: string): { bytes: Uint8Array; stem: string } {
  const buf = fs.readFileSync(filePath);
  const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  const stem = path.basename(filePath, path.extname(filePath));
  return { bytes, stem };
}

describe('PdfImportParser', () => {
  let parser: PdfImportParser;
  let testDir: string;
  const projectRoot = path.join(__dirname, '../../');
  const samplePdfPath = path.join(projectRoot, 'seascapes.pdf');

  beforeEach(() => {
    testDir = path.join(os.tmpdir(), `test-pdf-${Date.now()}`);
    fs.mkdirSync(testDir, { recursive: true });
    parser = new PdfImportParser(new NodePdfOpener());
  });

  afterEach(() => {
    try {
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true });
      }
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('PDF parsing with real scientific paper', () => {
    it('should parse a valid scientific paper PDF', async () => {
      if (!fs.existsSync(samplePdfPath)) {
        console.warn(`Sample PDF not found at ${samplePdfPath}, skipping test`);
        return;
      }

      const { bytes, stem } = readBytesAndStem(samplePdfPath);
      const result = await parser.parse(bytes, stem);

      expect(result).toBeDefined();
      expect(result.title).toBeTruthy();
      expect(result.citeKey).toBeTruthy();
      expect(result.authors).toBeDefined();
    }, 30000);

    it('should maintain consistency on multiple parses', async () => {
      if (!fs.existsSync(samplePdfPath)) {
        console.warn(`Sample PDF not found at ${samplePdfPath}, skipping test`);
        return;
      }

      const { bytes, stem } = readBytesAndStem(samplePdfPath);
      const result1 = await parser.parse(bytes, stem);
      const result2 = await parser.parse(bytes, stem);

      expect(result1.title).toBe(result2.title);
      expect(result1.citeKey).toBe(result2.citeKey);
      expect(result1.year).toBe(result2.year);
      expect(JSON.stringify(result1.authors)).toBe(JSON.stringify(result2.authors));
    }, 60000);
  });

  describe('pdfjs worker setup', () => {
    it('registers a main-thread worker on globalThis before parsing', async () => {
      delete (globalThis as Record<string, unknown>).pdfjsWorker;

      const validPdf = path.join(__dirname, '../fixtures/sample-valid.pdf');
      const { bytes, stem } = readBytesAndStem(validPdf);
      await parser.parse(bytes, stem);

      const registered = (globalThis as Record<string, unknown>).pdfjsWorker as
        | { WorkerMessageHandler?: unknown }
        | undefined;
      expect(registered?.WorkerMessageHandler).toBeDefined();
    });
  });

  describe('error handling', () => {
    it('should reject non-PDF content (no %PDF- header)', async () => {
      const bytes = new TextEncoder().encode('Not a PDF document at all');
      await expect(parser.parse(bytes, 'plain')).rejects.toThrow();
    });

    it('should reject corrupted PDF files', async () => {
      const bytes = new TextEncoder().encode('%PDF-corrupted data');
      await expect(parser.parse(bytes, 'corrupt')).rejects.toThrow();
    });
  });

  describe('metadata field validation', () => {
    it('should return array for authors field', async () => {
      if (!fs.existsSync(samplePdfPath)) {
        console.warn(`Sample PDF not found at ${samplePdfPath}, skipping test`);
        return;
      }

      const { bytes, stem } = readBytesAndStem(samplePdfPath);
      const result = await parser.parse(bytes, stem);
      expect(Array.isArray(result.authors)).toBe(true);
    }, 30000);

    it('should return valid title string', async () => {
      if (!fs.existsSync(samplePdfPath)) {
        console.warn(`Sample PDF not found at ${samplePdfPath}, skipping test`);
        return;
      }

      const { bytes, stem } = readBytesAndStem(samplePdfPath);
      const result = await parser.parse(bytes, stem);
      expect(typeof result.title).toBe('string');
      expect(result.title.length).toBeGreaterThan(0);
    }, 30000);

    it('should return valid cite key string', async () => {
      if (!fs.existsSync(samplePdfPath)) {
        console.warn(`Sample PDF not found at ${samplePdfPath}, skipping test`);
        return;
      }

      const { bytes, stem } = readBytesAndStem(samplePdfPath);
      const result = await parser.parse(bytes, stem);
      expect(typeof result.citeKey).toBe('string');
      expect(result.citeKey.length).toBeGreaterThan(0);
    }, 30000);
  });
});
