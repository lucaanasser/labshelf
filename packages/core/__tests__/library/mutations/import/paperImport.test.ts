import { importPdf, readPaperOnDisk, type ImportOutcome, type PaperRecord } from "@labshelf/core";

import { ATTENTION, makeImportDeps } from "../../../support/importFakes";
import { makeHarness, PAPERS, pdfBytes, type MutationHarness } from "../../../support/mutationHarness";

const INBOX = "/inbox";
const ML = `${PAPERS}/ML`;

async function writePdf(h: MutationHarness, name = "attention.pdf", bytes: Uint8Array | string = pdfBytes("download")): Promise<string> {
  const file = `${INBOX}/${name}`;
  await h.fs.writeFile(file, typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes);
  return file;
}

function added(outcome: ImportOutcome): { record: PaperRecord; needsReview: boolean } {
  if (outcome.status !== "added") { throw new Error(`expected an added outcome, got ${JSON.stringify(outcome)}`); }
  return outcome;
}

function libraryFiles(h: MutationHarness): string[] {
  return h.fs.fileList().filter((f) => f.startsWith(`${PAPERS}/`));
}

describe("importPdf", () => {
  it("creates <target>/<citeKey>/{paper.pdf, metadata.yaml, bib.bib} from the parsed metadata", async () => {
    const h = makeHarness();
    const deps = makeImportDeps();
    const bytes = pdfBytes("the original download");
    const file = await writePdf(h, "My Download (1).pdf", bytes);

    const outcome = await importPdf(h.ctx, deps, file, ML);

    const { record, needsReview } = added(outcome);
    expect(record).toMatchObject({ id: "vaswani2017attention", citeKey: "vaswani2017attention", title: ATTENTION.title, status: "unread", hasPdf: true });
    expect(needsReview).toBe(false);
    expect(outcome.input).toBe(file);
    const folder = `${ML}/vaswani2017attention`;
    expect(libraryFiles(h)).toEqual([`${folder}/bib.bib`, `${folder}/metadata.yaml`, `${folder}/paper.pdf`]);
    expect(await h.fs.readFile(`${folder}/paper.pdf`)).toEqual(bytes);
    expect(await h.readMeta(folder)).toEqual({
      title: ATTENTION.title, authors: ["Ashish Vaswani", "Noam Shazeer"], year: 2017, path: folder,
      citekey: "vaswani2017attention", status: "unread", source: "My Download (1).pdf", journal: "NeurIPS", doi: ATTENTION.doi,
    });
    const bib = await h.readBib(folder);
    expect(bib).toContain("author = {Ashish Vaswani and Noam Shazeer}");
    expect(bib).toContain(`file = {${folder}/paper.pdf}`);
    expect(deps.parse.mock.calls[0]![1]).toBe("My Download (1)");
    expect(h.logs.find((l) => l.message === "Paper imported from PDF")).toMatchObject({ level: "INFO", context: { id: "vaswani2017attention" } });
  });

  it("writes what a read from disk returns as the same paper", async () => {
    const h = makeHarness();
    const { record } = added(await importPdf(h.ctx, makeImportDeps(), await writePdf(h), ML));
    expect(await readPaperOnDisk(h.ctx, record.path)).toEqual(record);
  });

  it("names the source and the stem after sourceName when given (a download in a temp folder)", async () => {
    const h = makeHarness();
    const deps = makeImportDeps();
    const outcome = await importPdf(h.ctx, deps, await writePdf(h, "download-123.pdf"), PAPERS, { sourceName: "nature.pdf" });
    expect(outcome.input).toBe("nature.pdf");
    expect(deps.parse.mock.calls[0]![1]).toBe("nature");
    expect((await h.readMeta(added(outcome).record.path))["source"]).toBe("nature.pdf");
  });

  it("treats ids as taken regardless of case and also avoids folders the index does not know", async () => {
    const h = makeHarness();
    await h.fs.writeFile(`${PAPERS}/vaswani2017attentiona/paper.pdf`, pdfBytes());
    const deps = makeImportDeps([{ id: "Vaswani2017Attention" }]);
    const { record } = added(await importPdf(h.ctx, deps, await writePdf(h), PAPERS));
    expect(record.id).toBe("vaswani2017attentionb");
    expect(h.fs.fileList().filter((f) => f.includes("attentiona/"))).toEqual([`${PAPERS}/vaswani2017attentiona/paper.pdf`]);
  });

  it("reports a DOI the library already has, ignoring case, and writes nothing (BC13)", async () => {
    const h = makeHarness();
    const deps = makeImportDeps([{ id: "existing", doi: ATTENTION.doi!.toUpperCase() }]);
    const outcome = await importPdf(h.ctx, deps, await writePdf(h), PAPERS);
    expect(outcome).toMatchObject({ status: "duplicate", existingId: "existing" });
    expect(libraryFiles(h)).toEqual([]);
  });

  it("fails on bytes that are not a PDF, without calling the parser or creating a folder", async () => {
    const h = makeHarness();
    const deps = makeImportDeps();
    const outcome = await importPdf(h.ctx, deps, await writePdf(h, "fake.pdf", "<html>no</html>"), PAPERS);
    expect(outcome).toMatchObject({ status: "failed", error: "Not a PDF file" });
    expect(deps.parse).not.toHaveBeenCalled();
    expect(libraryFiles(h)).toEqual([]);
  });

  it("fails on a missing file", async () => {
    const h = makeHarness();
    const outcome = await importPdf(h.ctx, makeImportDeps(), `${INBOX}/missing.pdf`, PAPERS);
    expect(outcome.status).toBe("failed");
    expect(outcome.status === "failed" && outcome.error).toMatch(/ENOENT/);
  });

  it("fails, logs and writes nothing when the parser throws", async () => {
    const h = makeHarness();
    const deps = makeImportDeps();
    deps.parse.mockRejectedValueOnce(new Error("pdf.js exploded"));
    const outcome = await importPdf(h.ctx, deps, await writePdf(h), PAPERS);
    expect(outcome).toMatchObject({ status: "failed", error: "pdf.js exploded" });
    expect(libraryFiles(h)).toEqual([]);
    expect(h.logs.some((l) => l.level === "WARN" && l.message === "PDF import failed")).toBe(true);
  });

  it("refuses a buffer the parser consumed instead of writing a zero-byte paper.pdf", async () => {
    const h = makeHarness();
    const deps = makeImportDeps();
    deps.parse.mockImplementationOnce(async (bytes) => {
      const buffer = bytes.buffer as ArrayBuffer;
      structuredClone(buffer, { transfer: [buffer] });
      return { ...ATTENTION };
    });
    const outcome = await importPdf(h.ctx, deps, await writePdf(h), PAPERS);
    expect(outcome).toMatchObject({ status: "failed", error: expect.stringContaining("PDF buffer was consumed during parsing") });
    expect(libraryFiles(h)).toEqual([]);
  });

  it("flags unconfirmed metadata for review unless a DOI backs it", async () => {
    const h = makeHarness();
    const deps = makeImportDeps();
    deps.parse.mockResolvedValueOnce({ title: "Guessed", citeKey: "guess1", authors: [], confidence: "low" });
    deps.parse.mockResolvedValueOnce({ title: "With DOI", citeKey: "guess2", authors: [], confidence: "low", doi: "10.1000/x" });
    deps.parse.mockResolvedValueOnce({ title: "Medium", citeKey: "guess3", authors: [], confidence: "medium" });
    const flags = [];
    for (const name of ["a.pdf", "b.pdf", "c.pdf"]) { flags.push(added(await importPdf(h.ctx, deps, await writePdf(h, name), PAPERS)).needsReview); }
    expect(flags).toEqual([true, false, true]);
  });

  it("falls back to a slug of the file name when the parser has no cite key", async () => {
    const h = makeHarness();
    const deps = makeImportDeps();
    deps.parse.mockResolvedValueOnce({ title: "No key", citeKey: "", authors: [], confidence: "high" });
    expect(added(await importPdf(h.ctx, deps, await writePdf(h, "My Paper!.pdf"), PAPERS)).record.id).toBe("mypaper");
  });

  it("omits fields the parser did not find and never writes tags, note or hasPdf", async () => {
    const h = makeHarness();
    const deps = makeImportDeps();
    deps.parse.mockResolvedValueOnce({ title: "Bare", citeKey: "bare", authors: [], confidence: "high", journal: "" });
    await importPdf(h.ctx, deps, await writePdf(h), PAPERS);
    expect(await h.readMeta(`${PAPERS}/bare`)).toEqual({
      title: "Bare", authors: [], year: null, path: `${PAPERS}/bare`, citekey: "bare", status: "unread", source: "attention.pdf",
    });
  });
});
