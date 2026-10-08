import { promises as fs } from "node:fs";
import * as path from "node:path";

import type { ImportOutcome, ResolvedMetadata } from "@labshelf/core";

import { harness, metaFile, pdfResponse, type Harness } from "../../fixtures/paperService";
import { cleanupTempDirs, fakePdfBytes, listFiles, pathExists, readYaml } from "../../fixtures/library";

afterEach(cleanupTempDirs);

async function importOne(h: Harness, input: string, target = ""): Promise<ImportOutcome> {
  return (await h.service.importAny([input], target))[0]!;
}

describe("identifier import", () => {
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

    const outcome = await importOne(h, "10.1038/nature12373", "ML");

    expect(h.resolve).toHaveBeenCalledWith({ type: "doi", value: "10.1038/nature12373" });
    expect(outcome.status).toBe("added");
    if (outcome.status !== "added") { return; }
    expect(outcome.record).toMatchObject({ id: "kucsko2013nanometre", hasPdf: false, doi: "10.1038/nature12373", journal: "Nature", year: 2013 });
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

    const outcome = await importOne(h, "arXiv:1706.03762v2");

    expect(h.resolve).toHaveBeenCalledWith({ type: "arxiv", value: "1706.03762" });
    expect(outcome.status).toBe("added");
    if (outcome.status !== "added") { return; }
    expect(outcome.record).toMatchObject({ id: "vaswani2017attention", hasPdf: true, url: "https://arxiv.org/abs/1706.03762" });
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

    const outcome = await importOne(h, "1706.03762");

    expect(outcome.status).toBe("added");
    expect(outcome.status === "added" && outcome.record.hasPdf).toBe(false);
    expect(await listFiles(h.lib.paperDir("vaswani2017attention"))).toEqual(["bib.bib", "metadata.yaml"]);
  });

  it("keeps the paper without a PDF when the download fails (HTTP error or network error)", async () => {
    const h = await harness();
    h.resolve.mockResolvedValue(ARXIV);
    expect((await importOne(h, "1706.03762")).status).toBe("added");
    expect(await pathExists(path.join(h.lib.paperDir("vaswani2017attention"), "paper.pdf"))).toBe(false);

    const h2 = await harness();
    h2.resolve.mockResolvedValue(ARXIV);
    h2.fetch.mockRejectedValueOnce(new Error("network down"));
    const second = await importOne(h2, "1706.03762");
    expect(second.status === "added" && second.record.hasPdf).toBe(false);
  });

  it("keeps the paper without a PDF when the arXiv download is over 200 MB", async () => {
    const h = await harness();
    h.resolve.mockResolvedValue(ARXIV);
    h.routes.set("https://arxiv.org/pdf/1706.03762", () => new Response(fakePdfBytes(), { status: 200, headers: { "content-length": String(201 * 1024 * 1024) } }));
    const outcome = await importOne(h, "1706.03762");
    expect(outcome.status === "added" && outcome.record.hasPdf).toBe(false);
    expect(await listFiles(h.lib.paperDir("vaswani2017attention"))).toEqual(["bib.bib", "metadata.yaml"]);
  });

  it("falls through to the next identifier when the first one does not resolve to a title", async () => {
    const h = await harness();
    h.resolve.mockImplementation(async (id) => (id.type === "doi" ? NATURE : undefined));

    const outcome = await importOne(h, "see 10.1038/nature12373 and arXiv:1706.03762");

    expect(outcome.status).toBe("added");
    expect(outcome.status === "added" && outcome.record.doi).toBe("10.1038/nature12373");
    expect(outcome.status === "added" && outcome.record.hasPdf).toBe(false);
    expect(h.resolve.mock.calls.map(([id]) => id.type).sort()).toEqual(["arxiv", "doi"]);
  });

  it("stops at the first identifier that resolves", async () => {
    const h = await harness();
    h.resolve.mockResolvedValue(ARXIV);
    h.routes.set("https://arxiv.org/pdf/1706.03762", pdfResponse());
    const outcome = await importOne(h, "see 10.1000/abc and arXiv:1706.03762");
    expect(outcome.status).toBe("added");
    expect(h.resolve).toHaveBeenCalledTimes(1);
  });

  it("fails when no registry knows the identifier, or the lookup throws", async () => {
    const h = await harness();
    expect(await importOne(h, "1706.03762")).toEqual({
      status: "failed", error: "Could not find ARXIV 1706.03762", input: "1706.03762",
    });
    h.resolve.mockRejectedValue(new Error("registry down"));
    expect(await importOne(h, "10.1038/nature12373")).toEqual({
      status: "failed", error: "Could not find DOI 10.1038/nature12373", input: "10.1038/nature12373",
    });
    expect(await fs.readdir(h.lib.paths.layout.papersRoot())).toEqual([]);
  });

  it("fails when the text holds no identifier at all", async () => {
    const h = await harness();
    expect(await importOne(h, "just some words")).toEqual({
      status: "failed", error: "No DOI, arXiv id, PMID or ISBN found", input: "just some words",
    });
    expect(h.resolve).not.toHaveBeenCalled();
  });

  it("reports a DOI already in the library as a duplicate", async () => {
    const h = await harness([{ id: "have-it", meta: { doi: "10.1038/NATURE12373" } }]);
    h.resolve.mockResolvedValue(NATURE);
    expect(await importOne(h, "10.1038/nature12373")).toEqual({
      status: "duplicate", existingId: "have-it", input: "10.1038/nature12373",
    });
    expect(await fs.readdir(h.lib.paths.layout.papersRoot())).toEqual(["have-it"]);
  });

  it("de-duplicates the generated cite key against existing ids", async () => {
    const h = await harness([{ id: "kucsko2013nanometre" }]);
    h.resolve.mockResolvedValue(NATURE);
    const outcome = await importOne(h, "10.1038/nature12373");
    expect(outcome.status === "added" && outcome.record.id).toBe("kucsko2013nanometrea");
  });

  it("records the DOI the user typed when the registry record has none", async () => {
    const h = await harness();
    h.resolve.mockResolvedValue({ title: "Some Title Here", authors: ["Ann Lee"], year: 2020 });
    const outcome = await importOne(h, "10.1000/typed");
    expect(outcome.status === "added" && outcome.record.doi).toBe("10.1000/typed");
    expect((await readYaml(metaFile(h, "lee2020some")))["doi"]).toBe("10.1000/typed");
  });
});


describe("URL import", () => {
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
});
