import { promises as fs } from "node:fs";
import * as path from "node:path";

import { stringify } from "yaml";

import {
  BibTeXService,
  type DetectedIdentifier,
  type ILogger,
  type PaperRecord,
  type ParsedPdfImport,
  type PdfImportParser,
  type ResolvedMetadata,
} from "@labshelf/core";
import { NodeFileSystem } from "@labshelf/core/node";

import { readPaperFolder } from "../../src/library/libraryScanner";
import { LibraryStore } from "../../src/library/libraryStore";
import {
  TerminalPaperService,
  identifiersIn,
} from "../../src/library/paperService";
import {
  cleanupTempDirs,
  createTempLibrary,
  fakePdfBytes,
  listFiles,
  makeTempDir,
  pathExists,
  readYaml,
  setMtime,
  type PaperFixture,
  type TempLibrary,
} from "../fixtures/library";

afterEach(cleanupTempDirs);

const ATTENTION: ParsedPdfImport = {
  title: "Attention Is All You Need",
  citeKey: "vaswani2017attention",
  confidence: "high",
  source: "xmp",
  year: 2017,
  authors: ["Ashish Vaswani", "Noam Shazeer"],
  journal: "NeurIPS",
  doi: "10.5555/3295222.3295349",
};

const OLD = new Date("2020-01-01T00:00:00Z");

interface LogCall { level: string; module: string; message: string; context: Record<string, unknown> | undefined }

interface Harness {
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

async function harness(papers: PaperFixture[] = [], collections: string[] = []): Promise<Harness> {
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

function pdfResponse(label = "remote"): () => Response {
  return () => new Response(fakePdfBytes(label), { status: 200, headers: { "content-type": "application/pdf" } });
}

/** Edits metadata.yaml the way another app would: parse, change keys, write back. */
async function editYaml(file: string, change: Record<string, unknown>): Promise<void> {
  await fs.writeFile(file, stringify({ ...(await readYaml(file)), ...change }));
}

const metaFile = (h: Harness, id: string, collection?: string): string => path.join(h.lib.paperDir(id, collection), "metadata.yaml");
const bibFile = (h: Harness, id: string, collection?: string): string => path.join(h.lib.paperDir(id, collection), "bib.bib");

describe("pure helpers", () => {
  describe("identifiersIn", () => {
    it("reads a bare arXiv id, dropping the version", () => {
      expect(identifiersIn("1706.03762")).toEqual([{ type: "arxiv", value: "1706.03762" }]);
      expect(identifiersIn("  1706.03762v5 ")).toEqual([{ type: "arxiv", value: "1706.03762" }]);
    });

    it("reads a bare DOI", () => {
      expect(identifiersIn("10.1038/nature12373")).toEqual([{ type: "doi", value: "10.1038/nature12373" }]);
    });

    it("finds identifiers inside URLs and labelled text", () => {
      expect(identifiersIn("https://doi.org/10.1038/nature12373")).toEqual([{ type: "doi", value: "10.1038/nature12373" }]);
      expect(identifiersIn("arXiv:1706.03762")).toEqual([{ type: "arxiv", value: "1706.03762" }]);
      expect(identifiersIn("https://arxiv.org/abs/1706.03762")).toEqual([{ type: "arxiv", value: "1706.03762" }]);
    });

    it("returns nothing for text without identifiers", () => {
      expect(identifiersIn("hello world")).toEqual([]);
      expect(identifiersIn("https://example.org/files/paper.pdf")).toEqual([]);
    });
  });
});

describe("updateFields", () => {
  const base: PaperFixture = {
    id: "p1",
    collection: "ML",
    pdf: true,
    meta: {
      authors: ["Ashish Vaswani"], year: 2017, status: "unread", source: "original download (2).pdf",
      journal: "NeurIPS", doi: "10.5555/1", summary: "An abstract.",
      vscodeOnly: { nested: ["a", "b"] }, customKey: "keep me",
    },
  };

  it("writes status, tags and note to metadata.yaml and returns the updated record", async () => {
    const h = await harness([base]);
    const next = await h.service.updateFields("p1", { status: "reading", tags: ["NLP", "Vision"], note: "Read section 3 again" });

    const yaml = await readYaml(metaFile(h, "p1", "ML"));
    expect(yaml["status"]).toBe("reading");
    expect(yaml["tags"]).toEqual(["NLP", "Vision"]);
    expect(yaml["note"]).toBe("Read section 3 again");
    expect(next).toMatchObject({ id: "p1", status: "reading", tags: ["NLP", "Vision"], note: "Read section 3 again" });
    expect(h.store.paper("p1")!.record).toMatchObject({ status: "reading", tags: ["NLP", "Vision"], note: "Read section 3 again" });
  });

  it("preserves the existing source, unknown keys and every other field", async () => {
    const h = await harness([base]);
    await h.service.updateFields("p1", { status: "done" });
    const yaml = await readYaml(metaFile(h, "p1", "ML"));
    expect(yaml["source"]).toBe("original download (2).pdf");
    expect(yaml["vscodeOnly"]).toEqual({ nested: ["a", "b"] });
    expect(yaml["customKey"]).toBe("keep me");
    expect(yaml).toMatchObject({
      title: "Title of p1", authors: ["Ashish Vaswani"], year: 2017, journal: "NeurIPS", doi: "10.5555/1",
      summary: "An abstract.", citekey: "p1", status: "done",
    });
    expect(yaml["path"]).toBe(h.lib.paperDir("p1", "ML"));
  });

  it("keeps the textLayer verdict and keywords another app wrote", async () => {
    const h = await harness([{
      id: "p1",
      meta: { keywords: ["attention"], textLayer: { state: "ocr", ocrPages: 2, checkedAt: "2025-01-01T00:00:00.000Z" } },
    }]);
    await h.service.updateFields("p1", { status: "done" });
    const yaml = await readYaml(metaFile(h, "p1"));
    expect(yaml["keywords"]).toEqual(["attention"]);
    expect(yaml["textLayer"]).toEqual({ state: "ocr", ocrPages: 2, checkedAt: "2025-01-01T00:00:00.000Z" });
  });

  it("leaves tags and note alone when the patch does not set them", async () => {
    const h = await harness([{ id: "p1", meta: { tags: ["keep"], note: "keep this note" } }]);
    await h.service.updateFields("p1", { status: "reading" });
    const yaml = await readYaml(metaFile(h, "p1"));
    expect(yaml["tags"]).toEqual(["keep"]);
    expect(yaml["note"]).toBe("keep this note");
  });

  it("removes the note key for an empty note and the tags key for an empty tag list", async () => {
    const h = await harness([{ id: "p1", meta: { tags: ["a"], note: "something" } }]);
    await h.service.updateFields("p1", { note: "" });
    expect(await readYaml(metaFile(h, "p1"))).not.toHaveProperty("note");
    expect(await readYaml(metaFile(h, "p1"))).toHaveProperty("tags", ["a"]);
    await h.service.updateFields("p1", { tags: [] });
    expect(await readYaml(metaFile(h, "p1"))).not.toHaveProperty("tags");
  });

  it("normalizes tags: trim, collapse spaces, case-insensitive de-duplication, first spelling wins", async () => {
    const h = await harness([base]);
    await h.service.updateFields("p1", { tags: ["  NLP ", "nlp", "Deep   Learning", "", "deep learning", "Vision"] }, {});
    expect((await readYaml(metaFile(h, "p1", "ML")))["tags"]).toEqual(["NLP", "Deep Learning", "Vision"]);
  });

  it("writes nothing when the patch changes nothing", async () => {
    const h = await harness([{ ...base, meta: { ...base.meta, tags: ["NLP"], note: "n", status: "reading" }, bib: true }]);
    const files = [metaFile(h, "p1", "ML"), bibFile(h, "p1", "ML")];
    for (const file of files) { await setMtime(file, OLD); }
    const before = await Promise.all(files.map(async (f) => (await fs.stat(f)).mtimeMs));
    h.onLocalChange.mockClear();

    const same = await h.service.updateFields("p1", { status: "reading", tags: ["NLP"], note: "n" });
    const empty = await h.service.updateFields("p1", {});
    const trimmedTags = await h.service.updateFields("p1", { tags: ["  NLP  ", "nlp"] });

    expect(same?.id).toBe("p1");
    expect(empty?.id).toBe("p1");
    expect(trimmedTags?.id).toBe("p1");
    const after = await Promise.all(files.map(async (f) => (await fs.stat(f)).mtimeMs));
    expect(after).toEqual(before);
    expect(h.onLocalChange).not.toHaveBeenCalled();
  });

  it("returns undefined and writes nothing for an unknown paper", async () => {
    const h = await harness([base]);
    expect(await h.service.updateFields("ghost", { status: "done" })).toBeUndefined();
    expect(await readYaml(metaFile(h, "p1", "ML"))).toMatchObject({ status: "unread" });
  });

  it("re-reads metadata.yaml before writing, so a change another app made since the scan survives", async () => {
    const h = await harness([base]);
    // Another app (VS Code, a sync) edits the file after the terminal's last scan.
    const file = metaFile(h, "p1", "ML");
    const onDisk = await readYaml(file);
    await fs.writeFile(file, [
      `title: ${JSON.stringify(onDisk["title"])}`,
      "citekey: p1",
      "status: reading",
      "source: original download (2).pdf",
      "summary: Summary rewritten elsewhere",
      "journal: Changed Journal",
      "tags: [from-vscode]",
      "note: note typed in VS Code",
      "addedLater: true",
      "",
    ].join("\n"));
    expect(h.store.paper("p1")!.record.summary).toBe("An abstract.");

    await h.service.updateFields("p1", { status: "done" });

    const yaml = await readYaml(file);
    expect(yaml["status"]).toBe("done");
    expect(yaml["summary"]).toBe("Summary rewritten elsewhere");
    expect(yaml["journal"]).toBe("Changed Journal");
    expect(yaml["tags"]).toEqual(["from-vscode"]);
    expect(yaml["note"]).toBe("note typed in VS Code");
    expect(yaml["addedLater"]).toBe(true);
  });

  it("keeps a note written elsewhere when only the tags are patched, and vice versa", async () => {
    const h = await harness([base]);
    const file = metaFile(h, "p1", "ML");
    await editYaml(file, { note: "written elsewhere", tags: ["x"] });

    await h.service.updateFields("p1", { tags: ["y"] });
    expect(await readYaml(file)).toMatchObject({ tags: ["y"], note: "written elsewhere" });

    await editYaml(file, { tags: ["z"] });
    await h.service.updateFields("p1", { note: "mine" });
    expect(await readYaml(file)).toMatchObject({ tags: ["z"], note: "mine" });
  });

  it("finds a paper another app moved to a different collection since the scan", async () => {
    const h = await harness([base], ["Bio"]);
    const moved = h.lib.paperDir("p1", "Bio");
    await fs.rename(h.lib.paperDir("p1", "ML"), moved);

    const next = await h.service.updateFields("p1", { status: "done" });

    expect(next?.status).toBe("done");
    expect((await readYaml(path.join(moved, "metadata.yaml")))["status"]).toBe("done");
    expect(await pathExists(h.lib.paperDir("p1", "ML"))).toBe(false);
  });

  it("returns undefined for a paper that was deleted since the scan", async () => {
    const h = await harness([base]);
    await fs.rm(h.lib.paperDir("p1", "ML"), { recursive: true });
    expect(await h.service.updateFields("p1", { status: "done" })).toBeUndefined();
  });

  it("regenerates bib.bib, with a file line only while paper.pdf exists", async () => {
    const h = await harness([base, { id: "nopdf", meta: { authors: ["Ann Lee"] } }]);
    await fs.writeFile(bibFile(h, "p1", "ML"), "stale");
    await h.service.updateFields("p1", { status: "done" });
    const bib = await fs.readFile(bibFile(h, "p1", "ML"), "utf8");
    expect(bib).toContain("@article{p1,");
    expect(bib).toContain("  title = {Title of p1},");
    expect(bib).toContain("  author = {Ashish Vaswani},");
    expect(bib).toContain(`file = {${path.join(h.lib.paperDir("p1", "ML"), "paper.pdf")}}`);

    await h.service.updateFields("nopdf", { status: "done" });
    const bibNoPdf = await fs.readFile(bibFile(h, "nopdf"), "utf8");
    expect(bibNoPdf).toContain("@article{nopdf,");
    expect(bibNoPdf).not.toContain("file =");
  });

  it("writes the same bytes as the VS Code writeArtifacts rule (BibTeXService with the owned fields)", async () => {
    const h = await harness([], ["ML"]);
    const bibtex = new BibTeXService(new NodeFileSystem());
    const folder = h.lib.paperDir("p1", "ML");
    const twin = h.lib.paperDir("p1-twin", "ML");
    const record: PaperRecord = {
      id: "p1", title: "Attention Is All You Need", path: folder, citeKey: "p1", status: "unread",
      authors: ["Ashish Vaswani", "Noam Shazeer"], year: 2017, journal: "NeurIPS", doi: "10.5555/1", keywords: ["attention"],
    };
    for (const dir of [folder, twin]) {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, "paper.pdf"), fakePdfBytes());
    }
    // What the VS Code import writes first...
    await bibtex.writePaperArtifacts(folder, record, "my paper.pdf");
    await bibtex.writePaperArtifacts(twin, record, "my paper.pdf");
    await h.store.reload();

    await h.service.updateFields("p1", { status: "done", tags: ["NLP"], note: "n" });

    // ...and what VS Code's PaperService.writeArtifacts writes for the same change (same record, owned tags and note).
    await bibtex.writePaperArtifacts(twin, { ...record, status: "done", tags: ["NLP"], note: "n" }, path.join(folder, "paper.pdf"));
    expect(await fs.readFile(path.join(folder, "metadata.yaml"), "utf8")).toBe(await fs.readFile(path.join(twin, "metadata.yaml"), "utf8"));
    expect(await fs.readFile(path.join(folder, "bib.bib"), "utf8")).toBe(await fs.readFile(path.join(twin, "bib.bib"), "utf8"));
    expect((await readYaml(path.join(folder, "metadata.yaml")))["source"]).toBe("my paper.pdf");
  });

  it("never rewrites the title (Drive folders are named after it)", async () => {
    const odd = "  Spaced   Title: with a colon # and a hash, é 日本 ";
    const h = await harness([{ ...base, title: odd }]);
    await h.service.updateFields("p1", { status: "done", tags: ["x"], note: "n" });
    expect((await readYaml(metaFile(h, "p1", "ML")))["title"]).toBe(odd);
    expect(h.store.paper("p1")!.record.title).toBe(odd);
  });

  it("leaves no temporary files behind", async () => {
    const h = await harness([base]);
    await h.service.updateFields("p1", { status: "done" });
    expect(await listFiles(h.lib.paths.layout.tmpDir())).toEqual([]);
    expect((await listFiles(h.lib.paperDir("p1", "ML"))).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it("notifies the sync scheduler once per change, logs it, and reloads the store", async () => {
    const h = await harness([base]);
    const listener = jest.fn();
    h.store.onChange(listener);
    await h.service.updateFields("p1", { status: "done" });
    expect(h.onLocalChange).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(h.logs.find((l) => l.message === "Paper updated")).toMatchObject({ level: "INFO", context: { id: "p1", fields: ["status"] } });
  });

  it("skips the reload and the sync notification when asked to (batch callers do it once)", async () => {
    const h = await harness([base]);
    await h.service.updateFields("p1", { status: "done" }, { reload: false });
    expect(h.onLocalChange).not.toHaveBeenCalled();
    expect(h.store.paper("p1")!.record.status).toBe("unread");
    expect((await readYaml(metaFile(h, "p1", "ML")))["status"]).toBe("done");
  });
});

describe("setStatus / editTags", () => {
  it("sets the status of several papers with one reload and one sync notification", async () => {
    const h = await harness([{ id: "p1" }, { id: "p2", collection: "ML" }, { id: "p3", meta: { status: "done" } }]);
    const listener = jest.fn();
    h.store.onChange(listener);

    const outcome = await h.service.setStatus(["p1", "p2", "p3"], "done");

    expect(outcome).toEqual({ done: ["p1", "p2", "p3"], failed: [] });
    expect((await readYaml(metaFile(h, "p1")))["status"]).toBe("done");
    expect((await readYaml(metaFile(h, "p2", "ML")))["status"]).toBe("done");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(h.onLocalChange).toHaveBeenCalledTimes(1);
    expect(h.store.paper("p2")!.record.status).toBe("done");
  });

  it("reports unknown ids as failures without stopping the batch", async () => {
    const h = await harness([{ id: "p1" }, { id: "p2" }]);
    const outcome = await h.service.setStatus(["p1", "ghost", "p2"], "reading");
    expect(outcome.done).toEqual(["p1", "p2"]);
    expect(outcome.failed).toEqual([{ id: "ghost", error: "Paper not found" }]);
    expect((await readYaml(metaFile(h, "p2")))["status"]).toBe("reading");
  });

  it("reports a write failure for one paper and carries on with the others", async () => {
    const h = await harness([{ id: "p1" }, { id: "p2" }]);
    // A directory where bib.bib must go makes the write of that one paper fail.
    await fs.mkdir(bibFile(h, "p1"));
    await fs.writeFile(path.join(bibFile(h, "p1"), "blocker"), "x");

    const outcome = await h.service.setStatus(["p1", "p2"], "reading");

    expect(outcome.done).toEqual(["p2"]);
    expect(outcome.failed).toHaveLength(1);
    expect(outcome.failed[0]!.id).toBe("p1");
    expect(outcome.failed[0]!.error.length).toBeGreaterThan(0);
    expect((await readYaml(metaFile(h, "p2")))["status"]).toBe("reading");
  });

  it("adds and removes tags per paper, keeping each paper's other tags", async () => {
    const h = await harness([
      { id: "p1", meta: { tags: ["NLP", "keep"] } },
      { id: "p2" },
      { id: "p3", meta: { tags: ["other"] } },
    ]);
    const outcome = await h.service.editTags(["p1", "p2", "ghost"], ["new", "nlp"], ["  NLP "]);

    expect(outcome.done).toEqual(["p1", "p2"]);
    expect(outcome.failed).toEqual([{ id: "ghost", error: "Paper not found" }]);
    expect((await readYaml(metaFile(h, "p1")))["tags"]).toEqual(["keep", "new", "nlp"]);
    expect((await readYaml(metaFile(h, "p2")))["tags"]).toEqual(["new", "nlp"]);
    expect((await readYaml(metaFile(h, "p3")))["tags"]).toEqual(["other"]);
  });

  it("removes a tag case-insensitively and writes nothing when nothing changes", async () => {
    const h = await harness([{ id: "p1", meta: { tags: ["A", "b"] } }]);
    await setMtime(metaFile(h, "p1"), OLD);
    const before = (await fs.stat(metaFile(h, "p1"))).mtimeMs;

    const noop = await h.service.editTags(["p1"], [], ["zzz"]);
    expect(noop.done).toEqual(["p1"]);
    expect((await fs.stat(metaFile(h, "p1"))).mtimeMs).toBe(before);

    await h.service.editTags(["p1"], [], ["a"]);
    expect((await readYaml(metaFile(h, "p1")))["tags"]).toEqual(["b"]);
    await h.service.editTags(["p1"], [], ["B"]);
    expect(await readYaml(metaFile(h, "p1"))).not.toHaveProperty("tags");
  });

  it("works from the file's current tags, not the scanned ones", async () => {
    const h = await harness([{ id: "p1", meta: { tags: ["old"] } }]);
    const file = metaFile(h, "p1");
    await editYaml(file, { tags: ["added-elsewhere"] });
    await h.service.editTags(["p1"], ["mine"], []);
    expect((await readYaml(file))["tags"]).toEqual(["added-elsewhere", "mine"]);
  });
});

describe("movePapers", () => {
  it("moves the whole paper folder into the target collection, keeping its id and files", async () => {
    const h = await harness([{ id: "p1", collection: "ML", pdf: true, bib: true, sidecar: { annotations: [], theme: "dark" } }], ["Bio"]);
    const outcome = await h.service.movePapers(["p1"], "Bio");

    expect(outcome).toEqual({ done: ["p1"], failed: [] });
    expect(await listFiles(h.lib.paperDir("p1", "Bio"))).toEqual(["bib.bib", "metadata.yaml", "paper.pdf"]);
    expect(await pathExists(h.lib.paperDir("p1", "ML"))).toBe(false);
    expect(h.store.paper("p1")).toMatchObject({ collection: "Bio" });
    // The sidecar is keyed by id, so it needs no move.
    expect(await pathExists(h.lib.paths.layout.paperDataPath("p1"))).toBe(true);
    expect(h.onLocalChange).toHaveBeenCalledTimes(1);
  });

  it("can move to the library root (empty collection path)", async () => {
    const h = await harness([{ id: "p1", collection: "ML/Vision" }]);
    expect(await h.service.movePapers(["p1"], "")).toEqual({ done: ["p1"], failed: [] });
    expect(h.store.paper("p1")!.collection).toBe("");
  });

  it("moves several papers and reports each failure", async () => {
    const h = await harness([{ id: "a" }, { id: "b" }], ["Dest"]);
    const outcome = await h.service.movePapers(["a", "ghost", "b"], "Dest");
    expect(outcome.done).toEqual(["a", "b"]);
    expect(outcome.failed).toEqual([{ id: "ghost", error: "Paper not found" }]);
  });

  it("skips papers that are already in the target collection, without failing", async () => {
    const h = await harness([{ id: "a", collection: "ML" }]);
    expect(await h.service.movePapers(["a"], "ML")).toEqual({ done: [], failed: [] });
    expect(await pathExists(h.lib.paperDir("a", "ML"))).toBe(true);
  });

  it("fails on a name clash and leaves both folders untouched", async () => {
    const h = await harness([{ id: "a", title: "Mine" }], ["Dest"]);
    // A folder with that name already sits in the target (not a paper, so the id is still free).
    const clash = path.join(h.lib.paths.collectionDir("Dest"), "a");
    await fs.mkdir(clash);
    await fs.writeFile(path.join(clash, "keep.txt"), "x");

    const outcome = await h.service.movePapers(["a"], "Dest");

    expect(outcome.done).toEqual([]);
    expect(outcome.failed).toEqual([{ id: "a", error: '"a" already exists there' }]);
    expect(await pathExists(h.lib.paperDir("a"))).toBe(true);
    expect(await listFiles(clash)).toEqual(["keep.txt"]);
  });

  it("fails every id when the target collection does not exist", async () => {
    const h = await harness([{ id: "a" }, { id: "b" }]);
    const outcome = await h.service.movePapers(["a", "b"], "Nowhere");
    expect(outcome.done).toEqual([]);
    expect(outcome.failed.map((f) => f.id)).toEqual(["a", "b"]);
    expect(outcome.failed[0]!.error).toBe('Collection "Nowhere" does not exist');
    expect(await pathExists(h.lib.paperDir("a"))).toBe(true);
  });

  it("fails an unknown id", async () => {
    const h = await harness([], ["Dest"]);
    expect(await h.service.movePapers(["ghost"], "Dest")).toEqual({ done: [], failed: [{ id: "ghost", error: "Paper not found" }] });
  });
});

describe("trashPapers", () => {
  it("hands the paper folder to the injected trash and drops the paper from the library", async () => {
    const h = await harness([{ id: "p1", collection: "ML", pdf: true, sidecar: { annotations: [], theme: "auto" } }, { id: "p2" }]);
    const outcome = await h.service.trashPapers(["p1"]);

    expect(outcome).toEqual({ done: ["p1"], failed: [] });
    expect(h.trashed).toEqual([h.lib.paperDir("p1", "ML")]);
    expect(await pathExists(h.lib.paperDir("p1", "ML"))).toBe(false);
    expect(await pathExists(path.join(h.trashDir, "0-p1", "metadata.yaml"))).toBe(true);
    expect(h.store.paper("p1")).toBeUndefined();
    expect(h.store.paper("p2")).toBeDefined();
    // Sidecars stay, as in VS Code, so a restored paper keeps its notes.
    expect(await pathExists(h.lib.paths.layout.paperDataPath("p1"))).toBe(true);
    expect(h.onLocalChange).toHaveBeenCalledTimes(1);
  });

  it("reports an unknown id and a trash failure, and continues with the rest", async () => {
    const h = await harness([{ id: "a" }, { id: "b" }, { id: "c" }]);
    h.trash.mockImplementationOnce(async () => { throw new Error("trash is full"); });

    const outcome = await h.service.trashPapers(["a", "ghost", "b"]);

    expect(outcome.done).toEqual(["b"]);
    expect(outcome.failed).toEqual([
      { id: "a", error: "trash is full" },
      { id: "ghost", error: "Paper not found" },
    ]);
    expect(await pathExists(h.lib.paperDir("a"))).toBe(true);
    expect(await pathExists(h.lib.paperDir("b"))).toBe(false);
  });
});

describe("collections", () => {
  describe("createCollection", () => {
    it("creates a folder at the root and below another collection, returning its path", async () => {
      const h = await harness();
      expect(await h.service.createCollection("", "ML")).toBe("ML");
      expect(await h.service.createCollection("ML", "Vision")).toBe("ML/Vision");
      expect((await fs.stat(h.lib.paths.collectionDir("ML/Vision"))).isDirectory()).toBe(true);
      expect(h.store.collection("ML/Vision")).toBeDefined();
      expect(h.onLocalChange).toHaveBeenCalled();
    });

    it("trims the name", async () => {
      const h = await harness();
      expect(await h.service.createCollection("", "  Spaced  ")).toBe("Spaced");
      expect(await pathExists(h.lib.paths.collectionDir("Spaced"))).toBe(true);
    });

    it.each([
      ["", "The name cannot be empty."],
      ["   ", "The name cannot be empty."],
      ["a/b", "Use a name without slashes."],
      [".secret", "A collection name cannot start with a dot."],
      ["a".repeat(256), "The name is too long (at most 255 characters)."],
    ])("rejects %j", async (name, message) => {
      const h = await harness();
      await expect(h.service.createCollection("", name)).rejects.toThrow(message);
      expect(await fs.readdir(h.lib.paths.layout.papersRoot())).toEqual([]);
    });

    it("rejects a name that already exists", async () => {
      const h = await harness([], ["ML"]);
      await expect(h.service.createCollection("", "ML")).rejects.toThrow('"ML" already exists');
    });
  });

  describe("renameCollection", () => {
    it("renames the folder; the papers inside follow", async () => {
      const h = await harness([{ id: "p1", collection: "ML/Vision" }, { id: "p2", collection: "ML" }]);
      expect(await h.service.renameCollection("ML", "Machine Learning")).toBe("Machine Learning");
      expect(h.store.paper("p1")!.collection).toBe("Machine Learning/Vision");
      expect(h.store.paper("p2")!.collection).toBe("Machine Learning");
      expect(h.store.collection("ML")).toBeUndefined();
    });

    it("allows a rename that only changes letter case", async () => {
      const h = await harness([{ id: "p1", collection: "ml" }]);
      expect(await h.service.renameCollection("ml", "ML")).toBe("ML");
      expect(h.store.paper("p1")!.collection).toBe("ML");
    });

    it("renames a nested collection in place", async () => {
      const h = await harness([{ id: "p1", collection: "ML/Vision" }]);
      expect(await h.service.renameCollection("ML/Vision", "Seeing")).toBe("ML/Seeing");
      expect(h.store.paper("p1")!.collection).toBe("ML/Seeing");
    });

    it("is a no-op when the name does not change", async () => {
      const h = await harness([{ id: "p1", collection: "ML" }]);
      h.onLocalChange.mockClear();
      expect(await h.service.renameCollection("ML", "ML")).toBe("ML");
      expect(h.onLocalChange).not.toHaveBeenCalled();
    });

    it("rejects the library root, invalid names and clashes", async () => {
      const h = await harness([], ["ML", "Bio"]);
      await expect(h.service.renameCollection("", "X")).rejects.toThrow("The library root cannot be renamed");
      await expect(h.service.renameCollection("ML", "")).rejects.toThrow("The name cannot be empty.");
      await expect(h.service.renameCollection("ML", "a/b")).rejects.toThrow("Use a name without slashes.");
      await expect(h.service.renameCollection("ML", ".x")).rejects.toThrow("A collection name cannot start with a dot.");
      await expect(h.service.renameCollection("ML", "Bio")).rejects.toThrow('"Bio" already exists');
      expect(await pathExists(h.lib.paths.collectionDir("ML"))).toBe(true);
    });
  });

  describe("moveCollection", () => {
    it("moves a collection with everything in it under another collection", async () => {
      const h = await harness([{ id: "p1", collection: "ML/Vision", pdf: true }], ["Bio"]);
      expect(await h.service.moveCollection("ML/Vision", "Bio")).toBe("Bio/Vision");
      expect(h.store.paper("p1")!.collection).toBe("Bio/Vision");
      expect(await pathExists(h.lib.paths.collectionDir("ML/Vision"))).toBe(false);
      expect(await pathExists(path.join(h.lib.paperDir("p1", "Bio/Vision"), "paper.pdf"))).toBe(true);
    });

    it("moves a collection to the library root", async () => {
      const h = await harness([{ id: "p1", collection: "ML/Vision" }]);
      expect(await h.service.moveCollection("ML/Vision", "")).toBe("Vision");
      expect(h.store.paper("p1")!.collection).toBe("Vision");
    });

    it("is a no-op when the collection is already in that parent", async () => {
      const h = await harness([], ["ML/Vision"]);
      h.onLocalChange.mockClear();
      expect(await h.service.moveCollection("ML/Vision", "ML")).toBe("ML/Vision");
      expect(h.onLocalChange).not.toHaveBeenCalled();
    });

    it("rejects moving a collection into itself or into its own descendant", async () => {
      const h = await harness([], ["ML/Vision"]);
      await expect(h.service.moveCollection("ML", "ML")).rejects.toThrow("A collection cannot be moved into itself");
      await expect(h.service.moveCollection("ML", "ML/Vision")).rejects.toThrow("A collection cannot be moved into itself");
      expect(await pathExists(h.lib.paths.collectionDir("ML/Vision"))).toBe(true);
    });

    it("allows moving into a collection whose name merely starts with the same letters (not a descendant)", async () => {
      const h = await harness([{ id: "p1", collection: "ML2" }], ["ML"]);
      expect(await h.service.moveCollection("ML2", "ML")).toBe("ML/ML2");
      expect(h.store.paper("p1")!.collection).toBe("ML/ML2");
      expect(await h.service.moveCollection("ML/ML2", "")).toBe("ML2");

      const other = await harness([], ["ML", "ML2"]);
      expect(await other.service.moveCollection("ML", "ML2")).toBe("ML2/ML");
    });

    it("rejects the library root and a name clash", async () => {
      const h = await harness([], ["ML/Vision", "Bio/Vision"]);
      await expect(h.service.moveCollection("", "Bio")).rejects.toThrow("The library root cannot be moved");
      await expect(h.service.moveCollection("ML/Vision", "Bio")).rejects.toThrow('"Vision" already exists there');
    });
  });

  describe("trashCollection", () => {
    it("hands the folder (with its papers) to the trash and updates the library", async () => {
      const h = await harness([{ id: "p1", collection: "ML" }, { id: "p2" }]);
      await h.service.trashCollection("ML");
      expect(h.trashed).toEqual([h.lib.paths.collectionDir("ML")]);
      expect(h.store.collection("ML")).toBeUndefined();
      expect(h.store.paper("p1")).toBeUndefined();
      expect(h.store.paper("p2")).toBeDefined();
      expect(h.onLocalChange).toHaveBeenCalledTimes(1);
    });

    it("fails without deleting anything when the platform cannot trash (the error is passed on)", async () => {
      const h = await harness([{ id: "p1", collection: "ML" }]);
      h.trash.mockRejectedValueOnce(new Error("Moving to the trash is not supported on this platform"));
      await expect(h.service.trashCollection("ML")).rejects.toThrow("Moving to the trash is not supported on this platform");
      expect(await pathExists(h.lib.paperDir("p1", "ML"))).toBe(true);
      expect(h.store.paper("p1")).toBeDefined();
      expect(h.onLocalChange).not.toHaveBeenCalled();
    });

    it("refuses to trash the library root", async () => {
      const h = await harness([{ id: "p1" }]);
      await expect(h.service.trashCollection("")).rejects.toThrow("The library root cannot be deleted");
      expect(h.trash).not.toHaveBeenCalled();
    });
  });
});

describe("importPdf", () => {
  it("creates <collection>/<citeKey>/{paper.pdf, metadata.yaml, bib.bib} from the parsed metadata", async () => {
    const h = await harness([], ["ML"]);
    const bytes = fakePdfBytes("the original download");
    const file = await h.writePdf("My Download (1).pdf", bytes);

    const outcome = await h.service.importPdf(file, "ML");

    expect(outcome.status).toBe("added");
    if (outcome.status !== "added") { return; }
    expect(outcome.paper).toMatchObject({ id: "vaswani2017attention", citeKey: "vaswani2017attention", title: "Attention Is All You Need", status: "unread", hasPdf: true });
    expect(outcome.needsReview).toBe(false);
    expect(outcome.input).toBe(file);

    const folder = h.lib.paperDir("vaswani2017attention", "ML");
    expect(await listFiles(folder)).toEqual(["bib.bib", "metadata.yaml", "paper.pdf"]);
    expect(new Uint8Array(await fs.readFile(path.join(folder, "paper.pdf")))).toEqual(bytes);

    const yaml = await readYaml(path.join(folder, "metadata.yaml"));
    expect(yaml).toEqual({
      title: "Attention Is All You Need",
      authors: ["Ashish Vaswani", "Noam Shazeer"],
      year: 2017,
      path: folder,
      citekey: "vaswani2017attention",
      status: "unread",
      source: "My Download (1).pdf",
      journal: "NeurIPS",
      doi: "10.5555/3295222.3295349",
    });
    const bib = await fs.readFile(path.join(folder, "bib.bib"), "utf8");
    expect(bib).toContain("@article{vaswani2017attention,");
    expect(bib).toContain("author = {Ashish Vaswani and Noam Shazeer}");
    expect(bib).toContain(`file = {${path.join(folder, "paper.pdf")}}`);
    expect(h.parse).toHaveBeenCalledTimes(1);
    expect(h.parse.mock.calls[0]![1]).toBe("My Download (1)");
  });

  it("writes what a rescan reads back as the same paper (what VS Code's indexer would see)", async () => {
    const h = await harness([], ["ML"]);
    const outcome = await h.service.importPdf(await h.writePdf(), "ML");
    if (outcome.status !== "added") { throw new Error("expected the import to succeed"); }
    const entry = await readPaperFolder(h.lib.paths, outcome.paper.path);
    expect(entry!.record).toEqual(outcome.paper);
    expect(entry!.collection).toBe("ML");
  });

  it("imports into the library root", async () => {
    const h = await harness();
    const outcome = await h.service.importPdf(await h.writePdf(), "");
    expect(outcome.status).toBe("added");
    expect(await pathExists(path.join(h.lib.paths.layout.papersRoot(), "vaswani2017attention", "paper.pdf"))).toBe(true);
  });

  it("loads the PDF parser lazily, on the first import", async () => {
    const h = await harness();
    expect(h.parserFactory).not.toHaveBeenCalled();
    await h.service.importPdf(await h.writePdf(), "");
    expect(h.parserFactory).toHaveBeenCalledTimes(1);
  });

  it("gives a second paper with the same cite key the next free letter suffix", async () => {
    const h = await harness();
    for (const [i, expected] of ["vaswani2017attention", "vaswani2017attentiona", "vaswani2017attentionb"].entries()) {
      h.parse.mockResolvedValueOnce({ ...ATTENTION, doi: `10.1000/distinct-${i}` });
      const outcome = await h.service.importPdf(await h.writePdf(`f${i}.pdf`), "");
      expect(outcome.status).toBe("added");
      if (outcome.status === "added") { expect(outcome.paper.id).toBe(expected); }
      await h.store.reload();
    }
    expect(await fs.readdir(h.lib.paths.layout.papersRoot())).toEqual(["vaswani2017attention", "vaswani2017attentiona", "vaswani2017attentionb"]);
  });

  it("treats ids as taken regardless of case and also avoids folders the scan does not know", async () => {
    const h = await harness([{ id: "Vaswani2017Attention" }]);
    const orphan = path.join(h.lib.paths.layout.papersRoot(), "vaswani2017attentiona");
    await fs.mkdir(orphan);
    await fs.writeFile(path.join(orphan, "paper.pdf"), fakePdfBytes());
    h.parse.mockResolvedValueOnce({ ...ATTENTION, doi: "10.1000/other" });

    const outcome = await h.service.importPdf(await h.writePdf(), "");

    expect(outcome.status).toBe("added");
    if (outcome.status === "added") { expect(outcome.paper.id).toBe("vaswani2017attentionb"); }
    expect(await listFiles(orphan)).toEqual(["paper.pdf"]);
  });

  it("reports a duplicate DOI (case-insensitively) and writes nothing", async () => {
    const h = await harness([{ id: "existing", meta: { doi: "10.5555/3295222.3295349".toUpperCase() } }]);
    const outcome = await h.service.importPdf(await h.writePdf(), "");
    expect(outcome).toMatchObject({ status: "duplicate", existingId: "existing" });
    expect(await fs.readdir(h.lib.paths.layout.papersRoot())).toEqual(["existing"]);
  });

  it("fails on bytes that are not a PDF, without calling the parser or creating a folder", async () => {
    const h = await harness();
    const outcome = await h.service.importPdf(await h.writePdf("fake.pdf", "<html>definitely not a pdf</html>"), "");
    expect(outcome).toMatchObject({ status: "failed", error: "Not a PDF file" });
    expect(h.parse).not.toHaveBeenCalled();
    expect(await fs.readdir(h.lib.paths.layout.papersRoot())).toEqual([]);
  });

  it("fails on a missing file", async () => {
    const h = await harness();
    const outcome = await h.service.importPdf(path.join(h.inbox, "missing.pdf"), "");
    expect(outcome.status).toBe("failed");
    if (outcome.status === "failed") { expect(outcome.error).toMatch(/ENOENT/); }
  });

  it("fails, and writes nothing, when the parser throws", async () => {
    const h = await harness();
    h.parse.mockRejectedValueOnce(new Error("pdf.js exploded"));
    const outcome = await h.service.importPdf(await h.writePdf(), "");
    expect(outcome).toMatchObject({ status: "failed", error: "pdf.js exploded" });
    expect(await fs.readdir(h.lib.paths.layout.papersRoot())).toEqual([]);
    expect(h.logs.some((l) => l.level === "WARN" && l.message === "PDF import failed")).toBe(true);
  });

  it("flags unconfirmed metadata for review unless a DOI backs it", async () => {
    const h = await harness();
    h.parse.mockResolvedValueOnce({ title: "Guessed title", citeKey: "guess1", authors: [], confidence: "low" });
    h.parse.mockResolvedValueOnce({ title: "Guessed but with DOI", citeKey: "guess2", authors: [], confidence: "low", doi: "10.1000/x" });
    h.parse.mockResolvedValueOnce({ title: "Medium", citeKey: "guess3", authors: [], confidence: "medium" });
    const results = [];
    for (const name of ["a.pdf", "b.pdf", "c.pdf"]) { results.push(await h.service.importPdf(await h.writePdf(name), "")); }
    expect(results.map((r) => (r.status === "added" ? r.needsReview : "n/a"))).toEqual([true, false, true]);
  });

  it("falls back to a slug of the file name when the parser has no cite key", async () => {
    const h = await harness();
    h.parse.mockResolvedValueOnce({ title: "No key", citeKey: "", authors: [], confidence: "high" });
    const outcome = await h.service.importPdf(await h.writePdf("My Paper!.pdf"), "");
    expect(outcome.status === "added" && outcome.paper.id).toBe("mypaper");
  });

  it("omits fields the parser did not find (no empty journal/doi keys, no tags or note)", async () => {
    const h = await harness();
    h.parse.mockResolvedValueOnce({ title: "Bare", citeKey: "bare", authors: [], confidence: "high" });
    await h.service.importPdf(await h.writePdf(), "");
    const yaml = await readYaml(metaFile(h, "bare"));
    expect(yaml).toEqual({
      title: "Bare", authors: [], year: null, path: h.lib.paperDir("bare"), citekey: "bare", status: "unread", source: "attention.pdf",
    });
  });

  it("leaves no temporary files behind", async () => {
    const h = await harness();
    await h.service.importPdf(await h.writePdf(), "");
    expect(await listFiles(h.lib.paths.layout.tmpDir())).toEqual([]);
  });
});

describe("importIdentifier", () => {
  const NATURE: ResolvedMetadata = {
    title: "Nanometre-scale thermometry in a living cell",
    authors: ["G. Kucsko", "P. C. Maurer"],
    year: 2013,
    journal: "Nature",
    doi: "10.1038/nature12373",
  };
  const ARXIV: ResolvedMetadata = { title: "Attention Is All You Need", authors: ["Ashish Vaswani"], year: 2017 };

  it("saves a DOI as a reference without a PDF, keyed author + year + first title word (hyphens read as spaces)", async () => {
    const h = await harness([], ["ML"]);
    h.resolve.mockResolvedValue(NATURE);

    const outcome = await h.service.importIdentifier("10.1038/nature12373", "ML");

    expect(h.resolve).toHaveBeenCalledWith({ type: "doi", value: "10.1038/nature12373" });
    expect(outcome.status).toBe("added");
    if (outcome.status !== "added") { return; }
    expect(outcome.paper).toMatchObject({ id: "kucsko2013nanometre", hasPdf: false, doi: "10.1038/nature12373", journal: "Nature", year: 2013 });
    expect(outcome.needsReview).toBe(false);
    const folder = h.lib.paperDir("kucsko2013nanometre", "ML");
    expect(await listFiles(folder)).toEqual(["bib.bib", "metadata.yaml"]);
    const yaml = await readYaml(path.join(folder, "metadata.yaml"));
    expect(yaml).toMatchObject({ citekey: "kucsko2013nanometre", status: "unread", source: "paper.pdf", doi: "10.1038/nature12373", authors: ["G. Kucsko", "P. C. Maurer"] });
    expect(yaml["title"]).toBe("Nanometre scale thermometry in a living cell");
    expect(await fs.readFile(path.join(folder, "bib.bib"), "utf8")).not.toContain("file =");
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it("downloads the PDF of an arXiv paper and notes the abstract URL", async () => {
    const h = await harness();
    h.resolve.mockResolvedValue(ARXIV);
    h.routes.set("https://arxiv.org/pdf/1706.03762", pdfResponse("arxiv"));

    const outcome = await h.service.importIdentifier("arXiv:1706.03762v2", "");

    expect(h.resolve).toHaveBeenCalledWith({ type: "arxiv", value: "1706.03762" });
    expect(outcome.status).toBe("added");
    if (outcome.status !== "added") { return; }
    expect(outcome.paper).toMatchObject({ id: "vaswani2017attention", hasPdf: true, url: "https://arxiv.org/abs/1706.03762" });
    const folder = h.lib.paperDir("vaswani2017attention");
    expect(await listFiles(folder)).toEqual(["bib.bib", "metadata.yaml", "paper.pdf"]);
    expect(new Uint8Array(await fs.readFile(path.join(folder, "paper.pdf")))).toEqual(fakePdfBytes("arxiv"));
    expect((await readYaml(path.join(folder, "metadata.yaml")))["source"]).toBe("1706.03762.pdf");
    expect(h.fetch).toHaveBeenCalledWith("https://arxiv.org/pdf/1706.03762", expect.objectContaining({ redirect: "follow" }));
    expect(await fs.readFile(path.join(folder, "bib.bib"), "utf8")).toContain("file =");
  });

  it("keeps the paper without a PDF when the download returns an HTML page", async () => {
    const h = await harness();
    h.resolve.mockResolvedValue(ARXIV);
    h.routes.set("https://arxiv.org/pdf/1706.03762", () => new Response("<html>Please log in</html>", { status: 200 }));

    const outcome = await h.service.importIdentifier("1706.03762", "");

    expect(outcome.status).toBe("added");
    expect(outcome.status === "added" && outcome.paper.hasPdf).toBe(false);
    expect(await listFiles(h.lib.paperDir("vaswani2017attention"))).toEqual(["bib.bib", "metadata.yaml"]);
  });

  it("keeps the paper without a PDF when the download fails (HTTP error or network error)", async () => {
    const h = await harness();
    h.resolve.mockResolvedValue(ARXIV);
    expect((await h.service.importIdentifier("1706.03762", "")).status).toBe("added");
    expect(await pathExists(path.join(h.lib.paperDir("vaswani2017attention"), "paper.pdf"))).toBe(false);

    const h2 = await harness();
    h2.resolve.mockResolvedValue(ARXIV);
    h2.fetch.mockRejectedValueOnce(new Error("network down"));
    const second = await h2.service.importIdentifier("1706.03762", "");
    expect(second.status === "added" && second.paper.hasPdf).toBe(false);
  });

  it("keeps the paper without a PDF when the arXiv download is over 200 MB", async () => {
    const h = await harness();
    h.resolve.mockResolvedValue(ARXIV);
    h.routes.set("https://arxiv.org/pdf/1706.03762", () => new Response(fakePdfBytes(), { status: 200, headers: { "content-length": String(201 * 1024 * 1024) } }));
    const outcome = await h.service.importIdentifier("1706.03762", "");
    expect(outcome.status === "added" && outcome.paper.hasPdf).toBe(false);
    expect(await listFiles(h.lib.paperDir("vaswani2017attention"))).toEqual(["bib.bib", "metadata.yaml"]);
  });

  it("falls through to the next identifier when the first one does not resolve to a title", async () => {
    const h = await harness();
    h.resolve.mockImplementation(async (id) => (id.type === "doi" ? NATURE : undefined));

    const outcome = await h.service.importIdentifier("see 10.1038/nature12373 and arXiv:1706.03762", "");

    expect(outcome.status).toBe("added");
    expect(outcome.status === "added" && outcome.paper.doi).toBe("10.1038/nature12373");
    expect(outcome.status === "added" && outcome.paper.hasPdf).toBe(false);
    expect(h.resolve.mock.calls.map(([id]) => id.type).sort()).toEqual(["arxiv", "doi"]);
  });

  it("stops at the first identifier that resolves", async () => {
    const h = await harness();
    h.resolve.mockResolvedValue(ARXIV);
    h.routes.set("https://arxiv.org/pdf/1706.03762", pdfResponse());
    const outcome = await h.service.importIdentifier("see 10.1000/abc and arXiv:1706.03762", "");
    expect(outcome.status).toBe("added");
    expect(h.resolve).toHaveBeenCalledTimes(1);
  });

  it("fails when no registry knows the identifier, or the lookup throws", async () => {
    const h = await harness();
    expect(await h.service.importIdentifier("1706.03762", "")).toEqual({
      status: "failed", error: "Could not find ARXIV 1706.03762", input: "1706.03762",
    });
    h.resolve.mockRejectedValue(new Error("registry down"));
    expect(await h.service.importIdentifier("10.1038/nature12373", "")).toEqual({
      status: "failed", error: "Could not find DOI 10.1038/nature12373", input: "10.1038/nature12373",
    });
    expect(await fs.readdir(h.lib.paths.layout.papersRoot())).toEqual([]);
  });

  it("fails when the text holds no identifier at all", async () => {
    const h = await harness();
    expect(await h.service.importIdentifier("just some words", "")).toEqual({
      status: "failed", error: "No DOI, arXiv id, PMID or ISBN found", input: "just some words",
    });
    expect(h.resolve).not.toHaveBeenCalled();
  });

  it("reports a DOI already in the library as a duplicate", async () => {
    const h = await harness([{ id: "have-it", meta: { doi: "10.1038/NATURE12373" } }]);
    h.resolve.mockResolvedValue(NATURE);
    expect(await h.service.importIdentifier("10.1038/nature12373", "")).toEqual({
      status: "duplicate", existingId: "have-it", input: "10.1038/nature12373",
    });
    expect(await fs.readdir(h.lib.paths.layout.papersRoot())).toEqual(["have-it"]);
  });

  it("de-duplicates the generated cite key against existing ids", async () => {
    const h = await harness([{ id: "kucsko2013nanometre" }]);
    h.resolve.mockResolvedValue(NATURE);
    const outcome = await h.service.importIdentifier("10.1038/nature12373", "");
    expect(outcome.status === "added" && outcome.paper.id).toBe("kucsko2013nanometrea");
  });

  it("records the DOI the user typed when the registry record has none", async () => {
    const h = await harness();
    h.resolve.mockResolvedValue({ title: "Some Title Here", authors: ["Ann Lee"], year: 2020 });
    const outcome = await h.service.importIdentifier("10.1000/typed", "");
    expect(outcome.status === "added" && outcome.paper.doi).toBe("10.1000/typed");
    expect((await readYaml(metaFile(h, "lee2020some")))["doi"]).toBe("10.1000/typed");
  });
});

describe("importAny", () => {
  it("imports a PDF file, reloads the store and announces the change once", async () => {
    const h = await harness([], ["ML"]);
    const outcomes = await h.service.importAny([await h.writePdf()], "ML");

    expect(outcomes.map((o) => o.status)).toEqual(["added"]);
    expect(h.store.paper("vaswani2017attention")).toMatchObject({ collection: "ML" });
    expect(h.onLocalChange).toHaveBeenCalledTimes(1);
  });

  it("does not announce a change when nothing was added", async () => {
    const h = await harness([{ id: "have", meta: { doi: ATTENTION.doi } }]);
    const outcomes = await h.service.importAny([await h.writePdf(), path.join(h.inbox, "nope.txt")], "");
    expect(outcomes.map((o) => o.status)).toEqual(["duplicate", "failed"]);
    expect(h.onLocalChange).not.toHaveBeenCalled();
  });

  it("imports every PDF in a folder, recursively, in path order, skipping hidden folders and other files", async () => {
    const h = await harness();
    h.parse.mockImplementation(async (_bytes, stem) => ({ title: stem, citeKey: stem.toLowerCase(), authors: [], confidence: "high" }));
    await h.writePdf("dir/b.pdf");
    await h.writePdf("dir/a.pdf");
    await h.writePdf("dir/sub/deeper/C.PDF");
    await h.writePdf("dir/.hidden/d.pdf");
    await fs.writeFile(path.join(h.inbox, "dir", "notes.txt"), "not a pdf");
    const progress: Array<{ index: number; total: number; input: string }> = [];

    const outcomes = await h.service.importAny([path.join(h.inbox, "dir")], "", (p) => progress.push(p));

    expect(outcomes.map((o) => (o.status === "added" ? o.paper.id : o.status))).toEqual(["a", "b", "c"]);
    expect(progress.map((p) => [p.index, p.total])).toEqual([[1, 3], [2, 3], [3, 3]]);
    expect(progress.map((p) => path.relative(h.inbox, p.input))).toEqual(["dir/a.pdf", "dir/b.pdf", "dir/sub/deeper/C.PDF"]);
  });

  it("carries on with the other items when one fails, reporting each outcome in order", async () => {
    const h = await harness();
    const bad = await h.writePdf("bad.pdf", "<html>no</html>");
    const good = await h.writePdf("good.pdf");
    const outcomes = await h.service.importAny([bad, good, bad], "");
    expect(outcomes.map((o) => o.status)).toEqual(["failed", "added", "failed"]);
    expect(h.store.paper("vaswani2017attention")).toBeDefined();
  });

  it("lets later items see the ids earlier ones took", async () => {
    const h = await harness();
    h.parse.mockImplementation(async (_b, stem) => ({ title: stem, citeKey: "same", authors: [], confidence: "high", doi: `10.1000/${stem}` }));
    const outcomes = await h.service.importAny([await h.writePdf("one.pdf"), await h.writePdf("two.pdf")], "");
    expect(outcomes.map((o) => (o.status === "added" ? o.paper.id : o.status))).toEqual(["same", "samea"]);
  });

  it("sends identifiers to the registry lookup, and unknown local paths too", async () => {
    const h = await harness();
    h.resolve.mockResolvedValue({ title: "Resolved Paper", authors: ["Ann Lee"], year: 2020, doi: "10.1000/r" });
    const outcomes = await h.service.importAny(["10.1000/r", "no/such/file.pdf"], "");
    expect(outcomes.map((o) => o.status)).toEqual(["added", "failed"]);
    expect(h.resolve).toHaveBeenCalledTimes(1);
  });

  it("downloads an http URL that points at a PDF and imports it under the URL's file name", async () => {
    const h = await harness();
    h.routes.set("https://example.org/files/My%20Paper.pdf", pdfResponse("web"));

    const outcomes = await h.service.importAny(["https://example.org/files/My%20Paper.pdf"], "");

    expect(outcomes[0]!.status).toBe("added");
    expect(h.parse.mock.calls[0]![1]).toBe("My Paper");
    expect((await readYaml(metaFile(h, "vaswani2017attention")))["source"]).toBe("My Paper.pdf");
    expect(new Uint8Array(await fs.readFile(path.join(h.lib.paperDir("vaswani2017attention"), "paper.pdf")))).toEqual(fakePdfBytes("web"));
    expect(await listFiles(h.lib.paths.layout.tmpDir())).toEqual([]);
  });

  it("appends .pdf to a URL file name that lacks it", async () => {
    const h = await harness();
    h.routes.set("https://example.org/download/12345", pdfResponse());
    await h.service.importAny(["https://example.org/download/12345"], "");
    expect((await readYaml(metaFile(h, "vaswani2017attention")))["source"]).toBe("12345.pdf");
  });

  it("fails a URL that returns HTML, an HTTP error, or an oversized file", async () => {
    const h = await harness();
    h.routes.set("https://example.org/landing", () => new Response("<html></html>", { status: 200 }));
    h.routes.set("https://example.org/huge.pdf", () => new Response(fakePdfBytes(), { status: 200, headers: { "content-length": String(300 * 1024 * 1024) } }));

    const outcomes = await h.service.importAny(["https://example.org/landing", "https://example.org/missing.pdf", "https://example.org/huge.pdf"], "");

    expect(outcomes.map((o) => (o.status === "failed" ? o.error : o.status))).toEqual([
      "The URL did not return a PDF",
      "Download failed: HTTP 404",
      "The file is too large",
    ]);
    expect(await fs.readdir(h.lib.paths.layout.papersRoot())).toEqual([]);
    expect(await listFiles(h.lib.paths.layout.tmpDir())).toEqual([]);
  });

  it("treats a URL that contains an identifier as an identifier, not a download", async () => {
    const h = await harness();
    h.resolve.mockResolvedValue({ title: "Attention Is All You Need", authors: ["Ashish Vaswani"], year: 2017 });
    h.routes.set("https://arxiv.org/pdf/1706.03762", pdfResponse());
    const outcomes = await h.service.importAny(["https://arxiv.org/abs/1706.03762"], "");
    expect(outcomes[0]!.status).toBe("added");
    expect(h.fetch.mock.calls.map(([url]) => url)).toEqual(["https://arxiv.org/pdf/1706.03762"]);
  });

  it("ignores blank inputs", async () => {
    const h = await harness();
    expect(await h.service.importAny([], "")).toEqual([]);
    expect(await h.service.importAny(["", "   "], "")).toEqual([]);
  });
});

describe("bibtexFor", () => {
  const records: PaperRecord[] = [
    { id: "a", citeKey: "a", title: "First", path: "/lib/papers/a", status: "unread", authors: ["Ann Lee"], year: 2020, doi: "10.1/a" },
    { id: "b", citeKey: "b", title: "Second {braced}", path: "/lib/papers/b", status: "done", hasPdf: true },
  ];

  it("renders entries separated by a blank line, without the local file line", async () => {
    const h = await harness();
    const text = h.service.bibtexFor(records);
    expect(text).not.toContain("file =");
    expect(text).toContain("@article{a,");
    expect(text).toContain("@article{b,");
    expect(text).toContain("  doi = {10.1/a},");
    expect(text).toContain("title = {Second braced}");
    expect(text).toContain("},\n  keywords = {labshelf, imported}\n}\n\n@article{b,");
    expect(text.endsWith("}\n")).toBe(true);
  });

  it("renders a single entry", async () => {
    const h = await harness();
    expect(h.service.bibtexFor([records[0]!]).startsWith("@article{a,\n")).toBe(true);
  });
});
