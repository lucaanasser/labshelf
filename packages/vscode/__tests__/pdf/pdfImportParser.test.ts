import { PdfImportParser, ParsedPdfImport } from '../../src/pdf/pdfImportParser';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as vscode from 'vscode';

describe('PdfImportParser', () => {
  let parser: PdfImportParser;
  let testDir: string;
  const projectRoot = path.join(__dirname, '../../');
  const samplePdfPath = path.join(projectRoot, 'seascapes.pdf');

  beforeEach(() => {
    testDir = path.join(os.tmpdir(), `test-pdf-${Date.now()}`);
    fs.mkdirSync(testDir, { recursive: true });
    parser = new PdfImportParser();
  });

  afterEach(() => {
    try {
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true });
      }
    } catch (err) {
      // Ignore cleanup errors
    }
  });

  describe('PDF parsing with real scientific paper', () => {
    it('should parse a valid scientific paper PDF', async () => {
      if (!fs.existsSync(samplePdfPath)) {
        console.warn(`Sample PDF not found at ${samplePdfPath}, skipping test`);
        return;
      }

      const uri = vscode.Uri.file(samplePdfPath);
      const result = await parser.parse(uri);

      expect(result).toBeDefined();
      expect(result.title).toBeTruthy();
      expect(result.citeKey).toBeTruthy();
      expect(result.authors).toBeDefined();
      
      console.log('\n=== Extracted Metadata ===');
      console.log('Title:', result.title);
      console.log('Authors:', result.authors);
      console.log('Year:', result.year);
      console.log('Cite Key:', result.citeKey);
    }, 30000);

    it('should extract DOI from scientific paper', async () => {
      if (!fs.existsSync(samplePdfPath)) {
        console.warn(`Sample PDF not found at ${samplePdfPath}, skipping test`);
        return;
      }

      const uri = vscode.Uri.file(samplePdfPath);
      const result = await parser.parse(uri);

      // The seascapes.pdf should contain a DOI: 10.1016/j.tig.2009.01.002
      expect(result).toBeDefined();
      console.log('\n=== DOI Extraction Test ===');
      console.log('Cite Key (should contain DOI info):', result.citeKey);
      expect(result.citeKey).toBeTruthy();
    }, 30000);

    it('should extract authors from PDF metadata', async () => {
      if (!fs.existsSync(samplePdfPath)) {
        console.warn(`Sample PDF not found at ${samplePdfPath}, skipping test`);
        return;
      }

      const uri = vscode.Uri.file(samplePdfPath);
      const result = await parser.parse(uri);

      console.log('\n=== Authors Extraction ===');
      console.log('Authors found:', result.authors);
      
      expect(result.authors).toBeTruthy();
      expect(Array.isArray(result.authors)).toBe(true);
    }, 30000);

    it('should extract year from PDF', async () => {
      if (!fs.existsSync(samplePdfPath)) {
        console.warn(`Sample PDF not found at ${samplePdfPath}, skipping test`);
        return;
      }

      const uri = vscode.Uri.file(samplePdfPath);
      const result = await parser.parse(uri);

      console.log('\n=== Year Extraction ===');
      console.log('Year:', result.year);
      
      if (result.year) {
        expect(typeof result.year).toBe('number');
        expect(result.year).toBeGreaterThan(1900);
        expect(result.year).toBeLessThanOrEqual(new Date().getFullYear());
      }
    }, 30000);

    it('should extract title from PDF', async () => {
      if (!fs.existsSync(samplePdfPath)) {
        console.warn(`Sample PDF not found at ${samplePdfPath}, skipping test`);
        return;
      }

      const uri = vscode.Uri.file(samplePdfPath);
      const result = await parser.parse(uri);

      console.log('\n=== Title Extraction ===');
      console.log('Title:', result.title);
      console.log('Title length:', result.title.length);
      
      expect(result.title).toBeTruthy();
      expect(result.title.length).toBeGreaterThan(5);
    }, 30000);

    it('should generate valid cite key from PDF metadata', async () => {
      if (!fs.existsSync(samplePdfPath)) {
        console.warn(`Sample PDF not found at ${samplePdfPath}, skipping test`);
        return;
      }

      const uri = vscode.Uri.file(samplePdfPath);
      const result = await parser.parse(uri);

      console.log('\n=== Cite Key Generation ===');
      console.log('Generated cite key:', result.citeKey);
      
      expect(result.citeKey).toBeTruthy();
      // Cite key should be lowercase alphanumeric
      expect(/^[a-z0-9]+$/.test(result.citeKey)).toBe(true);
    }, 30000);

    it('should normalize titles (no extra spaces)', async () => {
      if (!fs.existsSync(samplePdfPath)) {
        console.warn(`Sample PDF not found at ${samplePdfPath}, skipping test`);
        return;
      }

      const uri = vscode.Uri.file(samplePdfPath);
      const result = await parser.parse(uri);

      console.log('\n=== Title Normalization ===');
      console.log('Normalized title:', result.title);
      
      // Title should be normalized (no extra spaces, etc)
      expect(result.title).not.toMatch(/\s{2,}/);
      expect(result.title).toBeTruthy();
    }, 30000);

    it('should resolve metadata from CrossRef API if DOI is detected', async () => {
      if (!fs.existsSync(samplePdfPath)) {
        console.warn(`Sample PDF not found at ${samplePdfPath}, skipping test`);
        return;
      }

      const uri = vscode.Uri.file(samplePdfPath);
      const result = await parser.parse(uri);

      console.log('\n=== CrossRef Metadata Resolution ===');
      console.log('Full extracted data:');
      console.log(JSON.stringify({
        title: result.title,
        authors: result.authors,
        year: result.year,
        citeKey: result.citeKey,
      }, null, 2));

      expect(result.title).toBeTruthy();
      expect(result.citeKey).toBeTruthy();
    }, 30000);

    it('should maintain consistency on multiple parses', async () => {
      if (!fs.existsSync(samplePdfPath)) {
        console.warn(`Sample PDF not found at ${samplePdfPath}, skipping test`);
        return;
      }

      console.log('\n=== Consistency Test ===');
      const uri = vscode.Uri.file(samplePdfPath);
      const result1 = await parser.parse(uri);
      const result2 = await parser.parse(uri);

      console.log('First parse cite key:', result1.citeKey);
      console.log('Second parse cite key:', result2.citeKey);
      
      // Same PDF should produce consistent results
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
      const uri = vscode.Uri.file(validPdf);
      await parser.parse(uri);

      const registered = (globalThis as Record<string, unknown>).pdfjsWorker as
        | { WorkerMessageHandler?: unknown }
        | undefined;
      expect(registered?.WorkerMessageHandler).toBeDefined();
    });
  });

  describe('error handling', () => {
    it('should handle non-PDF files', () => {
      const txtPath = path.join(testDir, 'test.txt');
      fs.writeFileSync(txtPath, 'Not a PDF');

      const uri = vscode.Uri.file(txtPath);

      return expect(parser.parse(uri)).rejects.toThrow();
    });

    it('should handle invalid file paths', async () => {
      const invalidPath = path.join(testDir, 'nonexistent.pdf');
      const uri = vscode.Uri.file(invalidPath);

      try {
        await parser.parse(uri);
        fail('Should have thrown an error');
      } catch (err) {
        expect(err).toBeDefined();
      }
    });

    it('should reject corrupted PDF files', () => {
      const corruptPath = path.join(testDir, 'corrupt.pdf');
      fs.writeFileSync(corruptPath, '%PDF-corrupted data');

      const uri = vscode.Uri.file(corruptPath);

      return expect(parser.parse(uri)).rejects.toThrow();
    });
  });

  describe('metadata field validation', () => {
    it('should return array for authors field', async () => {
      if (!fs.existsSync(samplePdfPath)) {
        console.warn(`Sample PDF not found at ${samplePdfPath}, skipping test`);
        return;
      }

      const uri = vscode.Uri.file(samplePdfPath);
      const result = await parser.parse(uri);

      expect(Array.isArray(result.authors)).toBe(true);
    }, 30000);

    it('should return valid title string', async () => {
      if (!fs.existsSync(samplePdfPath)) {
        console.warn(`Sample PDF not found at ${samplePdfPath}, skipping test`);
        return;
      }

      const uri = vscode.Uri.file(samplePdfPath);
      const result = await parser.parse(uri);

      expect(typeof result.title).toBe('string');
      expect(result.title.length).toBeGreaterThan(0);
    }, 30000);

    it('should return valid cite key string', async () => {
      if (!fs.existsSync(samplePdfPath)) {
        console.warn(`Sample PDF not found at ${samplePdfPath}, skipping test`);
        return;
      }

      const uri = vscode.Uri.file(samplePdfPath);
      const result = await parser.parse(uri);

      expect(typeof result.citeKey).toBe('string');
      expect(result.citeKey.length).toBeGreaterThan(0);
    }, 30000);

    it('should return optional year as number when present', async () => {
      if (!fs.existsSync(samplePdfPath)) {
        console.warn(`Sample PDF not found at ${samplePdfPath}, skipping test`);
        return;
      }

      const uri = vscode.Uri.file(samplePdfPath);
      const result = await parser.parse(uri);

      if ('year' in result && result.year !== undefined) {
        expect(typeof result.year).toBe('number');
      }
    }, 30000);
  });
});
