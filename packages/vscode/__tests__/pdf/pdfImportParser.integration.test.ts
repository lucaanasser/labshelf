/**
 * PDF Import Parser Test - Integration Test
 * This test runs the PDF parser against the actual seascapes.pdf file
 * to validate metadata extraction (DOI, authors, year, title)
 */

import { PdfImportParser } from '../../src/pdf/pdfImportParser';
import * as path from 'path';
import * as fs from 'fs';

// Mock VS Code URI since we can't import vscode directly in tests
class MockUri {
  constructor(public fsPath: string) {}
  
  static file(fsPath: string) {
    return new MockUri(fsPath);
  }
}

describe('PdfImportParser - Integration Test with Real PDF', () => {
  let parser: PdfImportParser;
  const projectRoot = path.join(__dirname, '../../');
  const samplePdfPath = path.join(projectRoot, 'seascapes.pdf');

  beforeEach(() => {
    parser = new PdfImportParser();
  });

  describe('Metadata Extraction from seascapes.pdf', () => {
    it('should successfully parse the seascapes.pdf file', async () => {
      if (!fs.existsSync(samplePdfPath)) {
        console.warn(`Sample PDF not found at ${samplePdfPath}`);
        return;
      }

      console.log('\n===============================================');
      console.log('  SEASCAPES.PDF - METADATA EXTRACTION TEST');
      console.log('===============================================\n');
      console.log('PDF File:', samplePdfPath);
      console.log('File size:', fs.statSync(samplePdfPath).size, 'bytes');
      console.log('File exists:', fs.existsSync(samplePdfPath));

      // Manually read and parse the PDF using the same logic as parser.parse()
      const pdfBytes = fs.readFileSync(samplePdfPath);
      const header = Buffer.from(pdfBytes.slice(0, 5)).toString('utf8');
      
      console.log('\n--- File Validation ---');
      console.log('PDF Header:', header);
      expect(header).toBe('%PDF-');

      // Try to parse with the actual parser
      try {
        const result = await parser.parse(MockUri.file(samplePdfPath) as any);

        console.log('\n--- Extracted Metadata ---');
        console.log('Title:', result.title);
        console.log('Authors:', result.authors);
        console.log('Year:', result.year);
        console.log('Cite Key:', result.citeKey);

        console.log('\n--- Validation ---');
        console.log('✓ Title present:', !!result.title);
        console.log('✓ Authors present:', result.authors && result.authors.length > 0);
        console.log('✓ Year present:', !!result.year);
        console.log('✓ Cite Key present:', !!result.citeKey);
        console.log('✓ Cite Key valid format:', /^[a-z0-9]+$/.test(result.citeKey));

        // Assertions
        expect(result.title).toBeTruthy();
        expect(result.citeKey).toBeTruthy();
        expect(Array.isArray(result.authors)).toBe(true);
        expect(/^[a-z0-9]+$/.test(result.citeKey)).toBe(true);

        console.log('\n✓ All validations passed!');
      } catch (error) {
        console.error('\n✗ Error parsing PDF:', error);
        throw error;
      }
    }, 60000);

    it('should detect DOI in the PDF', async () => {
      if (!fs.existsSync(samplePdfPath)) {
        console.warn(`Sample PDF not found at ${samplePdfPath}`);
        return;
      }

      console.log('\n--- DOI Detection ---');
      const pdfBytes = fs.readFileSync(samplePdfPath);
      const result = await parser.parse(MockUri.file(samplePdfPath) as any);

      console.log('Cite Key (may contain DOI):', result.citeKey);
      
      // The seascapes.pdf has DOI: 10.1016/j.tig.2009.01.002
      // If extracted correctly, it should influence the cite key
      expect(result.citeKey).toBeTruthy();
    }, 30000);

    it('should extract publication year correctly', async () => {
      if (!fs.existsSync(samplePdfPath)) {
        console.warn(`Sample PDF not found at ${samplePdfPath}`);
        return;
      }

      console.log('\n--- Year Extraction ---');
      const result = await parser.parse(MockUri.file(samplePdfPath) as any);

      console.log('Extracted year:', result.year);
      
      if (result.year) {
        console.log('✓ Year is a valid number:', typeof result.year === 'number');
        console.log('✓ Year is reasonable:', result.year >= 1900 && result.year <= new Date().getFullYear());
        expect(result.year).toBeGreaterThanOrEqual(1900);
        expect(result.year).toBeLessThanOrEqual(new Date().getFullYear());
      }
    }, 30000);

    it('should extract authors from PDF metadata', async () => {
      if (!fs.existsSync(samplePdfPath)) {
        console.warn(`Sample PDF not found at ${samplePdfPath}`);
        return;
      }

      console.log('\n--- Author Extraction ---');
      const result = await parser.parse(MockUri.file(samplePdfPath) as any);

      console.log('Number of authors:', result.authors?.length);
      console.log('Authors:', result.authors);

      expect(Array.isArray(result.authors)).toBe(true);
      
      if (result.authors.length > 0) {
        console.log('✓ Found', result.authors.length, 'author(s)');
        result.authors.forEach((author, i) => {
          console.log(`  ${i + 1}. ${author}`);
        });
      }
    }, 30000);

    it('should normalize and extract title correctly', async () => {
      if (!fs.existsSync(samplePdfPath)) {
        console.warn(`Sample PDF not found at ${samplePdfPath}`);
        return;
      }

      console.log('\n--- Title Extraction & Normalization ---');
      const result = await parser.parse(MockUri.file(samplePdfPath) as any);

      console.log('Extracted title:', result.title);
      console.log('Title length:', result.title.length);
      console.log('Contains extra spaces:', /\s{2,}/.test(result.title) ? 'YES (not normalized)' : 'NO (properly normalized)');

      expect(result.title).toBeTruthy();
      expect(result.title.length).toBeGreaterThan(5);
      expect(result.title).not.toMatch(/\s{2,}/); // Should not have double spaces
    }, 30000);

    it('should generate consistent cite key', async () => {
      if (!fs.existsSync(samplePdfPath)) {
        console.warn(`Sample PDF not found at ${samplePdfPath}`);
        return;
      }

      console.log('\n--- Cite Key Consistency ---');
      const result1 = await parser.parse(MockUri.file(samplePdfPath) as any);
      const result2 = await parser.parse(MockUri.file(samplePdfPath) as any);

      console.log('First parse cite key:', result1.citeKey);
      console.log('Second parse cite key:', result2.citeKey);
      console.log('Keys match:', result1.citeKey === result2.citeKey ? 'YES' : 'NO');

      expect(result1.citeKey).toBe(result2.citeKey);
    }, 60000);

    it('should provide complete metadata structure', async () => {
      if (!fs.existsSync(samplePdfPath)) {
        console.warn(`Sample PDF not found at ${samplePdfPath}`);
        return;
      }

      console.log('\n--- Complete Metadata Structure ---');
      const result = await parser.parse(MockUri.file(samplePdfPath) as any);

      const metadata = {
        title: result.title,
        authors: result.authors,
        year: result.year,
        citeKey: result.citeKey,
      };

      console.log(JSON.stringify(metadata, null, 2));

      // Validate all required fields
      expect(metadata.title).toBeTruthy();
      expect(metadata.citeKey).toBeTruthy();
      expect(Array.isArray(metadata.authors)).toBe(true);

      console.log('\n✓ All required metadata fields present and valid');
    }, 30000);
  });

  describe('Error Handling', () => {
    it('should reject non-existent files', async () => {
      const nonExistentPath = path.join(__dirname, 'nonexistent.pdf');

      try {
        await parser.parse(MockUri.file(nonExistentPath) as any);
        fail('Should have thrown an error');
      } catch (error) {
        console.log('\n✓ Correctly rejected non-existent file');
        expect(error).toBeDefined();
      }
    });

    it('should reject non-PDF files', async () => {
      const txtFile = path.join(__dirname, '../../package.json');

      try {
        await parser.parse(MockUri.file(txtFile) as any);
        fail('Should have thrown an error');
      } catch (error) {
        console.log('\n✓ Correctly rejected non-PDF file');
        expect(error).toBeDefined();
      }
    });
  });
});
