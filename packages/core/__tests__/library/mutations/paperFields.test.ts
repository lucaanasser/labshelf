import { editPaperTags, setPaperStatus, updatePaperFields } from "@labshelf/core";

import { makeHarness, PAPERS, type MutationHarness } from "../../support/mutationHarness";

const ML = `${PAPERS}/ML`;
const P1 = `${ML}/p1`;

const BASE_META = {
  title: "Title of p1", citekey: "p1", authors: ["Ashish Vaswani"], year: 2017, status: "unread",
  source: "original download (2).pdf", journal: "NeurIPS", doi: "10.5555/1", summary: "An abstract.",
  vscodeOnly: { nested: ["a", "b"] }, customKey: "keep me",
};

async function withBase(): Promise<MutationHarness> {
  const h = makeHarness();
  await h.seedPaper(P1, BASE_META);
  return h;
}

describe("updatePaperFields", () => {
  it("writes status, tags and note to metadata.yaml and returns the updated record", async () => {
    const h = await withBase();
    const next = await updatePaperFields(h.ctx, P1, { status: "reading", tags: ["NLP", "Vision"], note: "Read section 3 again" });
    expect(await h.readMeta(P1)).toMatchObject({ status: "reading", tags: ["NLP", "Vision"], note: "Read section 3 again" });
    expect(next).toMatchObject({ id: "p1", path: P1, status: "reading", tags: ["NLP", "Vision"], note: "Read section 3 again" });
  });

  it("preserves the source, unknown keys and every other field", async () => {
    const h = await withBase();
    await updatePaperFields(h.ctx, P1, { status: "done" });
    const yaml = await h.readMeta(P1);
    expect(yaml).toMatchObject({
      title: "Title of p1", authors: ["Ashish Vaswani"], year: 2017, journal: "NeurIPS", doi: "10.5555/1",
      summary: "An abstract.", citekey: "p1", status: "done", source: "original download (2).pdf",
      vscodeOnly: { nested: ["a", "b"] }, customKey: "keep me", path: P1,
    });
  });

  it("keeps the textLayer verdict and keywords another app wrote", async () => {
    const h = makeHarness();
    const textLayer = { state: "ocr", ocrPages: 2, checkedAt: "2025-01-01T00:00:00.000Z" };
    await h.seedPaper(P1, { title: "T", keywords: ["attention"], textLayer });
    await updatePaperFields(h.ctx, P1, { status: "done" });
    expect(await h.readMeta(P1)).toMatchObject({ keywords: ["attention"], textLayer });
  });

  it("never writes hasPdf", async () => {
    const h = await withBase();
    await updatePaperFields(h.ctx, P1, { status: "done" });
    expect(await h.readMeta(P1)).not.toHaveProperty("hasPdf");
  });

  it("leaves tags and note alone when the patch does not set them", async () => {
    const h = makeHarness();
    await h.seedPaper(P1, { title: "T", tags: ["keep"], note: "keep this note" });
    await updatePaperFields(h.ctx, P1, { status: "reading" });
    expect(await h.readMeta(P1)).toMatchObject({ tags: ["keep"], note: "keep this note" });
  });

  it("removes the note key for an empty note and the tags key for an empty tag list", async () => {
    const h = makeHarness();
    await h.seedPaper(P1, { title: "T", tags: ["a"], note: "something" });
    await updatePaperFields(h.ctx, P1, { note: "" });
    expect(await h.readMeta(P1)).not.toHaveProperty("note");
    expect(await h.readMeta(P1)).toHaveProperty("tags", ["a"]);
    await updatePaperFields(h.ctx, P1, { tags: [] });
    expect(await h.readMeta(P1)).not.toHaveProperty("tags");
  });

  it("normalizes tags: trim, collapse spaces, case-insensitive de-duplication, first spelling wins", async () => {
    const h = await withBase();
    await updatePaperFields(h.ctx, P1, { tags: ["  NLP ", "nlp", "Deep   Learning", "", "deep learning", "Vision"] });
    expect((await h.readMeta(P1))["tags"]).toEqual(["NLP", "Deep Learning", "Vision"]);
  });

  it("writes nothing when the patch changes nothing", async () => {
    const h = makeHarness();
    await h.seedPaper(P1, { ...BASE_META, tags: ["NLP"], note: "n", status: "reading" });
    const writes = h.fs.writes;
    expect((await updatePaperFields(h.ctx, P1, { status: "reading", tags: ["NLP"], note: "n" }))?.id).toBe("p1");
    expect((await updatePaperFields(h.ctx, P1, {}))?.id).toBe("p1");
    expect((await updatePaperFields(h.ctx, P1, { tags: ["  NLP  ", "nlp"] }))?.id).toBe("p1");
    expect(h.fs.writes).toBe(writes);
    expect(h.logs.filter((l) => l.message === "Paper updated")).toEqual([]);
  });

  it("returns undefined and writes nothing for a folder without a paper", async () => {
    const h = await withBase();
    const writes = h.fs.writes;
    expect(await updatePaperFields(h.ctx, `${ML}/ghost`, { status: "done" })).toBeUndefined();
    expect(h.fs.writes).toBe(writes);
  });

  it("works from metadata.yaml as it is now, so a change another app made survives", async () => {
    const h = await withBase();
    await h.seedPaper(P1, {
      title: "Title of p1", citekey: "p1", status: "reading", summary: "Summary rewritten elsewhere",
      tags: ["from-vscode"], note: "note typed in VS Code", addedLater: true,
    });
    await updatePaperFields(h.ctx, P1, { status: "done" });
    expect(await h.readMeta(P1)).toMatchObject({
      status: "done", summary: "Summary rewritten elsewhere", tags: ["from-vscode"], note: "note typed in VS Code", addedLater: true,
    });
  });

  it("keeps the on-disk status when only the tags change", async () => {
    const h = makeHarness();
    await h.seedPaper(P1, { title: "T", status: "reading" });
    const next = await updatePaperFields(h.ctx, P1, { tags: ["nlp"] });
    expect(next).toMatchObject({ status: "reading", tags: ["nlp"] });
    expect(await h.readMeta(P1)).toMatchObject({ status: "reading", tags: ["nlp"] });
  });

  it("regenerates bib.bib, with a file line only while paper.pdf exists", async () => {
    const h = await withBase();
    const noPdf = await h.seedPaper(`${PAPERS}/nopdf`, { title: "No PDF", authors: ["Ann Lee"] }, { pdf: false });
    await updatePaperFields(h.ctx, P1, { status: "done" });
    const bib = await h.readBib(P1);
    expect(bib).toContain("@article{p1,");
    expect(bib).toContain("  author = {Ashish Vaswani},");
    expect(bib).toContain(`file = {${P1}/paper.pdf}`);
    await updatePaperFields(h.ctx, noPdf, { status: "done" });
    expect(await h.readBib(noPdf)).not.toContain("file =");
  });

  it("never rewrites the title (Drive folders are named after it)", async () => {
    const odd = "  Spaced   Title: with a colon # and a hash, é 日本 ";
    const h = makeHarness();
    await h.seedPaper(P1, { title: odd });
    await updatePaperFields(h.ctx, P1, { status: "done", tags: ["x"], note: "n" });
    expect((await h.readMeta(P1))["title"]).toBe(odd);
  });

  it("logs the change", async () => {
    const h = await withBase();
    await updatePaperFields(h.ctx, P1, { status: "done" });
    expect(h.logs.find((l) => l.message === "Paper updated")).toMatchObject({ level: "INFO", context: { id: "p1", fields: ["status"] } });
  });
});

describe("setPaperStatus / editPaperTags", () => {
  const ref = (id: string, dir = PAPERS) => ({ id, path: `${dir}/${id}` });

  it("sets the status of several papers and returns their records", async () => {
    const h = makeHarness();
    await h.seedPaper(`${PAPERS}/p1`, { title: "1" });
    await h.seedPaper(`${ML}/p2`, { title: "2" });
    await h.seedPaper(`${PAPERS}/p3`, { title: "3", status: "done" });
    const outcome = await setPaperStatus(h.ctx, [ref("p1"), ref("p2", ML), ref("p3")], "done");
    expect(outcome.done).toEqual(["p1", "p2", "p3"]);
    expect(outcome.failed).toEqual([]);
    expect(outcome.records.map((r) => [r.id, r.status])).toEqual([["p1", "done"], ["p2", "done"], ["p3", "done"]]);
    expect((await h.readMeta(`${ML}/p2`))["status"]).toBe("done");
  });

  it("reports missing papers and write failures without stopping the batch, and logs each", async () => {
    const h = makeHarness();
    await h.seedPaper(`${PAPERS}/p1`, { title: "1" });
    await h.seedPaper(`${PAPERS}/p2`, { title: "2" });
    const artifacts = h.ctx.artifacts;
    h.ctx.artifacts = {
      writePaperArtifacts: async (folder, paper, source) => {
        if (paper.id === "p1") { throw new Error("disk full"); }
        await artifacts.writePaperArtifacts(folder, paper, source);
      },
    };
    const outcome = await setPaperStatus(h.ctx, [ref("p1"), ref("ghost"), ref("p2")], "reading");
    expect(outcome.done).toEqual(["p2"]);
    expect(outcome.failed).toEqual([{ id: "p1", error: "disk full" }, { id: "ghost", error: "Paper not found" }]);
    expect(h.logs.filter((l) => l.message === "Paper update failed")).toHaveLength(2);
    expect((await h.readMeta(`${PAPERS}/p2`))["status"]).toBe("reading");
  });

  it("adds and removes tags per paper, keeping each paper's other tags", async () => {
    const h = makeHarness();
    await h.seedPaper(`${PAPERS}/p1`, { title: "1", tags: ["NLP", "keep"] });
    await h.seedPaper(`${PAPERS}/p2`, { title: "2" });
    const outcome = await editPaperTags(h.ctx, [ref("p1"), ref("p2"), ref("ghost")], ["new", "nlp"], ["  NLP "]);
    expect(outcome.done).toEqual(["p1", "p2"]);
    expect(outcome.failed).toEqual([{ id: "ghost", error: "Paper not found" }]);
    expect((await h.readMeta(`${PAPERS}/p1`))["tags"]).toEqual(["keep", "new", "nlp"]);
    expect((await h.readMeta(`${PAPERS}/p2`))["tags"]).toEqual(["new", "nlp"]);
  });

  it("removes a tag case-insensitively and writes nothing when nothing changes", async () => {
    const h = makeHarness();
    await h.seedPaper(`${PAPERS}/p1`, { title: "1", tags: ["A", "b"] });
    const writes = h.fs.writes;
    expect((await editPaperTags(h.ctx, [ref("p1")], [], ["zzz"])).done).toEqual(["p1"]);
    expect(h.fs.writes).toBe(writes);
    await editPaperTags(h.ctx, [ref("p1")], [], ["a"]);
    expect((await h.readMeta(`${PAPERS}/p1`))["tags"]).toEqual(["b"]);
    await editPaperTags(h.ctx, [ref("p1")], [], ["B"]);
    expect(await h.readMeta(`${PAPERS}/p1`)).not.toHaveProperty("tags");
  });
});
