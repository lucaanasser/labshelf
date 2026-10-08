import { discoverPdfs, importPaths, importPdfs, type ImportOutcome, type PdfImportParser, type PdfParse } from "@labshelf/core";

import { makeImportDeps } from "../../../support/importFakes";
import { makeHarness, PAPERS, pdfBytes, type MutationHarness } from "../../../support/mutationHarness";

const INBOX = "/inbox";

async function writePdfs(h: MutationHarness, names: string[]): Promise<string[]> {
  for (const name of names) { await h.fs.writeFile(`${INBOX}/${name}`, pdfBytes(name)); }
  return names.map((name) => `${INBOX}/${name}`);
}

function ids(outcomes: ImportOutcome[]): string[] {
  return outcomes.map((o) => (o.status === "added" ? o.record.id : o.status));
}

describe("discoverPdfs", () => {
  it("walks folders recursively in sorted path order, skipping dot entries and non-PDF files (BC18)", async () => {
    const h = makeHarness();
    await writePdfs(h, ["dir/b.pdf", "dir/a.pdf", "dir/sub/deeper/C.PDF", "dir/.hidden/d.pdf", "dir/.e.pdf"]);
    await h.fs.writeText(`${INBOX}/dir/notes.txt`, "not a pdf");
    expect(await discoverPdfs(h.ctx, [`${INBOX}/dir`])).toEqual({
      pdfs: [`${INBOX}/dir/a.pdf`, `${INBOX}/dir/b.pdf`, `${INBOX}/dir/sub/deeper/C.PDF`],
      skipped: [],
    });
  });

  it("logs a folder it cannot read and carries on with the others (BC18)", async () => {
    const h = makeHarness();
    await writePdfs(h, ["dir/locked/x.pdf", "dir/open/y.pdf"]);
    h.fs.unreadable.add(`${INBOX}/dir/locked`);
    expect((await discoverPdfs(h.ctx, [`${INBOX}/dir`])).pdfs).toEqual([`${INBOX}/dir/open/y.pdf`]);
    expect(h.logs.find((l) => l.message === "Import skipped a folder it could not read")).toMatchObject({
      level: "WARN", context: { dir: `${INBOX}/dir/locked` },
    });
  });

  it("skips a symlinked PDF inside a folder and as a direct input (BC19)", async () => {
    const h = makeHarness();
    await writePdfs(h, ["dir/real.pdf"]);
    h.fs.symlinks.add(`${INBOX}/dir/link.pdf`);
    h.fs.symlinks.add(`${INBOX}/top-link.pdf`);
    expect(await discoverPdfs(h.ctx, [`${INBOX}/dir`, `${INBOX}/top-link.pdf`])).toEqual({
      pdfs: [`${INBOX}/dir/real.pdf`], skipped: [`${INBOX}/top-link.pdf`],
    });
  });

  it("keeps picked files whatever their extension, in input order, and skips missing inputs", async () => {
    const h = makeHarness();
    const [z, a] = await writePdfs(h, ["z.bin", "a.pdf"]);
    expect(await discoverPdfs(h.ctx, [z!, `${INBOX}/missing.pdf`, a!])).toEqual({ pdfs: [z, a], skipped: [`${INBOX}/missing.pdf`] });
  });
});

describe("importPdfs", () => {
  it("lets later files see the ids and DOIs earlier ones took in the same batch", async () => {
    const h = makeHarness();
    const deps = makeImportDeps();
    deps.parse.mockImplementation(async (_b, stem) => ({ title: stem, citeKey: "same", authors: [], confidence: "high", doi: `10.1000/${stem}` }));
    const files = await writePdfs(h, ["one.pdf", "two.pdf"]);
    expect(ids(await importPdfs(h.ctx, deps, files, PAPERS))).toEqual(["same", "samea"]);

    deps.parse.mockImplementation(async () => ({ title: "t", citeKey: "dup", authors: [], confidence: "high", doi: "10.1000/SHARED" }));
    const outcomes = await importPdfs(h.ctx, deps, await writePdfs(h, ["x.pdf", "y.pdf"]), PAPERS);
    expect(outcomes.map((o) => o.status)).toEqual(["added", "duplicate"]);
    expect(outcomes[1]).toMatchObject({ existingId: "dup" });
  });

  it("reports progress and carries on when one file fails", async () => {
    const h = makeHarness();
    await h.fs.writeText(`${INBOX}/bad.pdf`, "<html>no</html>");
    const [good] = await writePdfs(h, ["good.pdf"]);
    const progress: Array<[number, number, string]> = [];
    const outcomes = await importPdfs(h.ctx, makeImportDeps(), [`${INBOX}/bad.pdf`, good!], PAPERS, (p) => progress.push([p.index, p.total, p.input]));
    expect(outcomes.map((o) => o.status)).toEqual(["failed", "added"]);
    expect(progress).toEqual([[1, 2, `${INBOX}/bad.pdf`], [2, 2, good]]);
  });
});

describe("importPaths", () => {
  it("imports the PDFs of picked folders and files, then lists skipped inputs", async () => {
    const h = makeHarness();
    const deps = makeImportDeps();
    deps.parse.mockImplementation(async (_b, stem) => ({ title: stem, citeKey: stem.toLowerCase(), authors: [], confidence: "high" }));
    await writePdfs(h, ["dir/b.pdf", "dir/a.pdf"]);
    const outcomes = await importPaths(h.ctx, deps, [`${INBOX}/dir`, `${INBOX}/missing`], PAPERS);
    expect(ids(outcomes)).toEqual(["a", "b", "skipped"]);
    expect(outcomes[2]).toEqual({ status: "skipped", input: `${INBOX}/missing` });
  });
});

describe("PdfParse", () => {
  it("is satisfied by the io PdfImportParser", () => {
    const parser = { parse: jest.fn() } as unknown as PdfImportParser;
    const parse: PdfParse = (bytes, stem) => parser.parse(bytes, stem);
    expect(typeof parse).toBe("function");
  });
});
