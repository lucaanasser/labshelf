/**
 * Regression tests for the PDF byte buffer lifetime.
 *
 * pdfjs takes ownership of the `data` array it is given and detaches it, so a
 * caller that parses a PDF before copying it to disk ends up writing zero
 * bytes — producing a library entry whose viewer fails with "The PDF file is
 * empty, i.e. its size is zero bytes."
 */

import * as vscode from 'vscode';
import { PaperService } from '../../src/core/paperService';
import { NodePdfOpener } from '../../src/pdf/nodePdfOpener';
import type { IResearchDatabase, ExtensionEventBus, PdfImportParser, BibTeXService } from '@labshelf/core';
import type { FileSystemService } from '../../src/storage/fileSystemService';
import type { ILibraryPaths } from '../../src/storage/paths/libraryPaths';

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

describe('PaperService.addPaperFromUri byte safety', () => {
  function makeService(parse: PdfImportParser['parse']): {
    service: PaperService;
    writeFile: jest.Mock;
  } {
    const mockDb: Partial<IResearchDatabase> = {
      upsertPaper: jest.fn(async () => {}),
      listPapers: jest.fn(async () => []),
    };
    const mockEventBus: Partial<ExtensionEventBus> = { emit: jest.fn(), on: jest.fn() };
    const mockFsService: Partial<FileSystemService> = { ensureDirectory: jest.fn(async () => {}) };
    const mockPaths: Partial<ILibraryPaths> = {
      papersRoot: jest.fn(() => vscode.Uri.file('/workspace/papers')),
    };
    const mockBibTeX: Partial<BibTeXService> = { writePaperArtifacts: jest.fn(async () => {}) };

    const service = new PaperService(
      mockFsService as FileSystemService,
      mockDb as IResearchDatabase,
      mockEventBus as ExtensionEventBus,
      mockPaths as ILibraryPaths,
      { parse } as PdfImportParser,
      mockBibTeX as BibTeXService,
    );

    return { service, writeFile: vscode.workspace.fs.writeFile as jest.Mock };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    (vscode.workspace.fs.stat as jest.Mock).mockResolvedValue({ type: vscode.FileType.File });
    (vscode.workspace.fs.writeFile as jest.Mock).mockResolvedValue(undefined);
    (vscode.workspace.fs.readFile as jest.Mock).mockResolvedValue(new Uint8Array(2048).fill(9));
  });

  it('copies the full PDF into the library', async () => {
    const { service, writeFile } = makeService(
      jest.fn(async () => ({ title: 'Paper', citeKey: 'paper2024', authors: [] })) as never,
    );

    await service.addPaperFromUri(vscode.Uri.file('/docs/paper.pdf'));

    const written = writeFile.mock.calls.at(-1)?.[1] as Uint8Array;
    expect(written.byteLength).toBe(2048);
  });

  it('fails loudly instead of storing a zero-byte paper.pdf', async () => {
    const { service, writeFile } = makeService(
      jest.fn(async (bytes: Uint8Array) => {
        detach(bytes);
        return { title: 'Paper', citeKey: 'paper2024', authors: [] };
      }) as never,
    );

    await expect(service.addPaperFromUri(vscode.Uri.file('/docs/paper.pdf'))).rejects.toThrow(
      /consumed during parsing/i,
    );
    expect(writeFile).not.toHaveBeenCalled();
  });
});
