/** A paper service over a throwaway library, with fakes for the trash, the PDF parser, the registries and fetch. */
import { promises as fs } from "node:fs";
import * as path from "node:path";

import {
  BibTeXService,
  type DetectedIdentifier,
  type ILogger,
  type ParsedPdfImport,
  type PdfImportParser,
  type ResolvedMetadata,
} from "@labshelf/core";
import { NodeFileSystem } from "@labshelf/core/node";

import { LibraryStore } from "../../src/library/libraryStore";
import { TerminalPaperService } from "../../src/library/papers/paperService";
import {
  createTempLibrary,
  fakePdfBytes,
  makeTempDir,
  type PaperFixture,
  type TempLibrary,
} from "./library";

export const ATTENTION: ParsedPdfImport = {
  title: "Attention Is All You Need",
  citeKey: "vaswani2017attention",
  confidence: "high",
  source: "xmp",
  year: 2017,
  authors: ["Ashish Vaswani", "Noam Shazeer"],
  journal: "NeurIPS",
  doi: "10.5555/3295222.3295349",
};

export interface LogCall { level: string; module: string; message: string; context: Record<string, unknown> | undefined }

export interface Harness {
  lib: TempLibrary;
  store: LibraryStore;
  service: TerminalPaperService;
  trashDir: string;
  trashed: string[];
  trash: jest.Mock<Promise<string>, [string]>;
  onLocalChange: jest.Mock;
  logs: LogCall[];
  parse: jest.Mock<Promise<ParsedPdfImport>, [Uint8Array, string]>;
  parserFactory: jest.Mock<Promise<PdfImportParser>, []>;
  resolve: jest.Mock<Promise<ResolvedMetadata | undefined>, [DetectedIdentifier]>;
  fetch: jest.Mock<Promise<Response>, [string, (RequestInit | undefined)?]>;
  routes: Map<string, () => Response>;
  inbox: string;
  /** Writes a PDF into the inbox folder and returns its path. */
  writePdf(name?: string, bytes?: Uint8Array | string): Promise<string>;
}

export async function harness(papers: PaperFixture[] = [], collections: string[] = []): Promise<Harness> {
  const lib = await createTempLibrary(papers);
  for (const rel of collections) { await lib.addCollection(rel); }
  const store = new LibraryStore(lib.paths);
  await store.reload();
  const trashDir = await makeTempDir("labshelf-trash-");
  const inbox = await makeTempDir("labshelf-inbox-");
  const trashed: string[] = [];
  const logs: LogCall[] = [];
  const logger: ILogger = {
    log: async (level, module, message, context) => { logs.push({ level, module, message, context }); },
    error: async () => undefined,
  };
  const trash = jest.fn(async (target: string): Promise<string> => {
    const destination = path.join(trashDir, `${trashed.length}-${path.basename(target)}`);
    await fs.rename(target, destination);
    trashed.push(target);
    return destination;
  });
  const parse = jest.fn(async (_bytes: Uint8Array, _stem: string): Promise<ParsedPdfImport> => ({ ...ATTENTION }));
  const parserFactory = jest.fn(async () => ({ parse }) as unknown as PdfImportParser);
  const resolve = jest.fn(async (_id: DetectedIdentifier): Promise<ResolvedMetadata | undefined> => undefined);
  const routes = new Map<string, () => Response>();
  const fetchMock = jest.fn(async (url: string, _init?: RequestInit | undefined): Promise<Response> => {
    const route = routes.get(String(url));
    return route ? route() : new Response("not found", { status: 404 });
  });
  const onLocalChange = jest.fn();
  const service = new TerminalPaperService({
    paths: lib.paths,
    store,
    bibtex: new BibTeXService(new NodeFileSystem(lib.paths.layout.tmpDir())),
    logger,
    pdfParser: parserFactory,
    trash,
    fetch: fetchMock as unknown as typeof fetch,
    resolveIdentifier: resolve,
    onLocalChange,
  });
  return {
    lib, store, service, trashDir, trashed, trash, onLocalChange, logs, parse, parserFactory, resolve,
    fetch: fetchMock, routes, inbox,
    async writePdf(name = "attention.pdf", bytes = fakePdfBytes("download")) {
      const file = path.join(inbox, name);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, bytes);
      return file;
    },
  };
}

export function pdfResponse(label = "remote"): () => Response {
  return () => new Response(fakePdfBytes(label), { status: 200, headers: { "content-type": "application/pdf" } });
}

export const metaFile = (h: Harness, id: string, collection?: string): string => path.join(h.lib.paperDir(id, collection), "metadata.yaml");
