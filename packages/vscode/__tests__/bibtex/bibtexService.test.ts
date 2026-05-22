import * as vscode from 'vscode';
import { BibTeXService } from '@labshelf/core';
import { VscodeFileSystem } from '../../src/storage/vscodeFileSystem';
import type { PaperRecord } from '@labshelf/core';

function makePaper(overrides: Partial<PaperRecord> = {}): PaperRecord {
  return {
    id: 'test2024',
    title: 'A Test Paper',
    path: '/tmp/papers/test2024',
    citeKey: 'test2024',
    status: 'unread',
    ...overrides,
  };
}

let svc: BibTeXService;

beforeEach(() => {
  jest.clearAllMocks();
  (vscode.workspace.fs.writeFile as jest.Mock).mockResolvedValue(undefined);
  (vscode.workspace.fs.createDirectory as jest.Mock).mockResolvedValue(undefined);
  svc = new BibTeXService(new VscodeFileSystem());
});

describe('BibTeXService.generateBibTeX', () => {
  it('generates a valid @article entry with citeKey', () => {
    const result = svc.generateBibTeX(makePaper());
    expect(result).toContain('@article{test2024,');
    expect(result).toContain('title = {A Test Paper}');
  });

  it('includes year when present', () => {
    const result = svc.generateBibTeX(makePaper({ year: 2024 }));
    expect(result).toContain('year = {2024}');
  });

  it('omits year when absent', () => {
    const result = svc.generateBibTeX(makePaper());
    expect(result).not.toContain('year =');
  });

  it('formats multiple authors with "and"', () => {
    const result = svc.generateBibTeX(makePaper({ authors: ['Alice Foo', 'Bob Bar'] }));
    expect(result).toContain('Alice Foo and Bob Bar');
  });

  it('uses "Unknown" as author when authors array is empty', () => {
    const result = svc.generateBibTeX(makePaper({ authors: [] }));
    expect(result).toContain('author = {Unknown}');
  });

  it('includes doi when present', () => {
    const result = svc.generateBibTeX(makePaper({ doi: '10.000/test' }));
    expect(result).toContain('doi = {10.000/test}');
  });

  it('strips curly braces from field values', () => {
    const result = svc.generateBibTeX(makePaper({ title: 'A {nested} title' }));
    expect(result).not.toContain('{nested}');
    expect(result).toContain('A nested title');
  });
});

describe('BibTeXService.writePaperArtifacts', () => {
  it('writes metadata.yaml and bib.bib', async () => {
    const paper = makePaper({ authors: ['Alice'], year: 2024 });
    const folder = '/tmp/papers/test2024';

    await svc.writePaperArtifacts(folder, paper, '/src/paper.pdf');

    expect(vscode.workspace.fs.writeFile).toHaveBeenCalledTimes(2);
    const paths = (vscode.workspace.fs.writeFile as jest.Mock).mock.calls.map(
      ([uri]: [vscode.Uri]) => uri.fsPath,
    );
    expect(paths.some(p => p.endsWith('metadata.yaml'))).toBe(true);
    expect(paths.some(p => p.endsWith('bib.bib'))).toBe(true);
  });
});
