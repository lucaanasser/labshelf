import { withResolvedMetadata, writePaperRecord, type PaperRecord } from "@labshelf/core";

import { makeHarness, PAPERS } from "../../support/mutationHarness";

// The terminal app (or a sync) can change a paper's status on disk before another app re-indexes it. A rewrite made
// for another reason must not put the stale indexed status back (sync contract, "Status ownership").

const FOLDER = `${PAPERS}/vaswani2017`;
const indexed: PaperRecord = {
  id: "vaswani2017", title: "Attention", path: FOLDER, citeKey: "vaswani2017", status: "unread", hasPdf: true,
};

describe("writePaperRecord", () => {
  it("keeps the on-disk status when rewriting resolved metadata", async () => {
    const h = makeHarness();
    await h.seedPaper(FOLDER, { title: "Attention", status: "reading" });
    const written = await writePaperRecord(h.ctx, withResolvedMetadata(indexed, { title: "Attention Is All You Need" }), { ownsStatus: false });
    expect(written).toMatchObject({ title: "Attention Is All You Need", status: "reading" });
    expect(await h.readMeta(FOLDER)).toMatchObject({ title: "Attention Is All You Need", status: "reading" });
  });

  it("writes the status the caller owns", async () => {
    const h = makeHarness();
    await h.seedPaper(FOLDER, { title: "Attention", status: "reading" });
    await writePaperRecord(h.ctx, { ...indexed, status: "done" }, { ownsStatus: true });
    expect((await h.readMeta(FOLDER))["status"]).toBe("done");
  });

  it("falls back to the indexed status, and logs it, when metadata.yaml cannot be read", async () => {
    const h = makeHarness();
    await h.fs.writeFile(`${FOLDER}/paper.pdf`, new Uint8Array([1]));
    const written = await writePaperRecord(h.ctx, { ...indexed, status: "reading" }, { ownsStatus: false });
    expect(written.status).toBe("reading");
    expect((await h.readMeta(FOLDER))["status"]).toBe("reading");
    expect(h.logs.find((l) => l.message.startsWith("Status on disk unreadable"))).toMatchObject({
      level: "WARN", context: { id: "vaswani2017", status: "reading" },
    });
  });

  it("falls back to the indexed status when the file's status is not a valid one", async () => {
    const h = makeHarness();
    await h.seedPaper(FOLDER, { title: "Attention", status: "toread" });
    await writePaperRecord(h.ctx, indexed, { ownsStatus: false });
    expect((await h.readMeta(FOLDER))["status"]).toBe("unread");
    expect(h.logs.some((l) => l.level === "WARN")).toBe(true);
  });

  it("keeps the file's tags, note and foreign keys unless the caller sets tags or note", async () => {
    const h = makeHarness();
    await h.seedPaper(FOLDER, { title: "Attention", tags: ["kept"], note: "kept note", browserOnly: { a: 1 } });
    await writePaperRecord(h.ctx, { ...indexed, tags: ["stale"], note: "stale" }, { ownsStatus: false });
    expect(await h.readMeta(FOLDER)).toMatchObject({ tags: ["kept"], note: "kept note", browserOnly: { a: 1 } });

    await writePaperRecord(h.ctx, indexed, { ownsStatus: false, tags: ["mine"], note: "my note" });
    expect(await h.readMeta(FOLDER)).toMatchObject({ tags: ["mine"], note: "my note", browserOnly: { a: 1 } });
  });

  it("stores the text-layer verdict, never hasPdf, and regenerates bib.bib", async () => {
    const h = makeHarness();
    await h.seedPaper(FOLDER, { title: "Attention" });
    const textLayer = { state: "native" as const, checkedAt: "2026-01-01T00:00:00.000Z" };
    await writePaperRecord(h.ctx, { ...indexed, textLayer }, { ownsStatus: false });
    const yaml = await h.readMeta(FOLDER);
    expect(yaml["textLayer"]).toEqual(textLayer);
    expect(yaml).not.toHaveProperty("hasPdf");
    expect(await h.readBib(FOLDER)).toContain("@article{vaswani2017,");
  });
});

describe("withResolvedMetadata", () => {
  it("overwrites bibliographic fields that are set and keeps identity and empty ones", () => {
    const next = withResolvedMetadata({ ...indexed, journal: "Old", year: 2016 }, {
      title: "", authors: [], year: 2017, journal: "NeurIPS", doi: "10.1/x", keywords: ["a"],
    });
    expect(next).toEqual({ ...indexed, journal: "NeurIPS", year: 2017, doi: "10.1/x", keywords: ["a"] });
  });
});
