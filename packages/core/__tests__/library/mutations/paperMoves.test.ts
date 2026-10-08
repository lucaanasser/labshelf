import { movePapers, trashPapers } from "@labshelf/core";

import { makeHarness, PAPERS, type MutationHarness } from "../../support/mutationHarness";

const ML = `${PAPERS}/ML`;
const BIO = `${PAPERS}/Bio`;
const SIDECAR = "/lib/.research/papers/p1/data.json";

async function seeded(): Promise<MutationHarness> {
  const h = makeHarness();
  await h.fs.mkdir(BIO);
  await h.seedPaper(`${ML}/p1`, { title: "1" });
  await h.seedPaper(`${PAPERS}/a`, { title: "a" });
  await h.seedPaper(`${PAPERS}/b`, { title: "b" });
  await h.fs.writeText(SIDECAR, "{}");
  return h;
}

describe("movePapers", () => {
  it("moves the whole paper folder and reports where it went; the sidecar stays", async () => {
    const h = await seeded();
    const outcome = await movePapers(h.ctx, [{ id: "p1", path: `${ML}/p1` }], BIO);
    expect(outcome).toEqual({ done: ["p1"], failed: [], moves: [{ id: "p1", from: `${ML}/p1`, to: `${BIO}/p1` }] });
    expect(h.fs.fileList().filter((f) => f.startsWith(`${BIO}/p1/`))).toEqual([`${BIO}/p1/metadata.yaml`, `${BIO}/p1/paper.pdf`]);
    expect(await h.fs.exists(`${ML}/p1`)).toBe(false);
    expect(await h.fs.exists(SIDECAR)).toBe(true);
    expect(h.logs.find((l) => l.message === "Papers moved")).toMatchObject({ level: "INFO", context: { ids: ["p1"] } });
  });

  it("moves to the library root", async () => {
    const h = await seeded();
    expect((await movePapers(h.ctx, [{ id: "p1", path: `${ML}/p1` }], PAPERS)).done).toEqual(["p1"]);
    expect(await h.fs.exists(`${PAPERS}/p1/metadata.yaml`)).toBe(true);
  });

  it("skips papers already in the target folder, without failing", async () => {
    const h = await seeded();
    expect(await movePapers(h.ctx, [{ id: "p1", path: `${ML}/p1` }], ML)).toEqual({ done: [], failed: [], moves: [] });
    expect(h.fs.renames).toEqual([]);
  });

  it("fails on a name clash with the BC17 message and leaves both folders untouched, carrying on with the rest", async () => {
    const h = await seeded();
    await h.fs.writeText(`${BIO}/a/keep.txt`, "x");
    const outcome = await movePapers(h.ctx, [{ id: "a", path: `${PAPERS}/a` }, { id: "b", path: `${PAPERS}/b` }], BIO);
    expect(outcome.done).toEqual(["b"]);
    expect(outcome.failed).toEqual([{ id: "a", error: '"a" already exists there' }]);
    expect(await h.fs.exists(`${PAPERS}/a/metadata.yaml`)).toBe(true);
    expect(await h.fs.exists(`${BIO}/a/keep.txt`)).toBe(true);
    expect(h.logs.find((l) => l.message === "Paper move failed")).toMatchObject({ level: "WARN", context: { id: "a" } });
  });

  it("fails every paper when the target folder does not exist", async () => {
    const h = await seeded();
    const outcome = await movePapers(h.ctx, [{ id: "a", path: `${PAPERS}/a` }, { id: "b", path: `${PAPERS}/b` }], `${PAPERS}/Nowhere`);
    expect(outcome.done).toEqual([]);
    expect(outcome.failed).toEqual([
      { id: "a", error: 'The folder "Nowhere" does not exist' },
      { id: "b", error: 'The folder "Nowhere" does not exist' },
    ]);
    expect(h.fs.renames).toEqual([]);
  });

  it("reports a paper whose folder is gone", async () => {
    const h = await seeded();
    const outcome = await movePapers(h.ctx, [{ id: "ghost", path: `${PAPERS}/ghost` }], BIO);
    expect(outcome.failed).toHaveLength(1);
    expect(outcome.failed[0]!.id).toBe("ghost");
  });
});

describe("trashPapers", () => {
  it("trashes each paper folder and keeps its sidecar", async () => {
    const h = await seeded();
    const outcome = await trashPapers(h.ctx, [{ id: "p1", path: `${ML}/p1` }]);
    expect(outcome).toEqual({ done: ["p1"], failed: [] });
    expect(h.fs.trashed).toEqual([`${ML}/p1`]);
    expect(await h.fs.exists(SIDECAR)).toBe(true);
    expect(h.logs.find((l) => l.message === "Papers moved to trash")).toMatchObject({ context: { ids: ["p1"] } });
  });

  it("captures and logs a failed trash per paper, leaves that paper in place and carries on", async () => {
    const h = await seeded();
    h.fs.trashFails.add(`${PAPERS}/a`);
    const outcome = await trashPapers(h.ctx, [{ id: "a", path: `${PAPERS}/a` }, { id: "b", path: `${PAPERS}/b` }]);
    expect(outcome.done).toEqual(["b"]);
    expect(outcome.failed).toEqual([{ id: "a", error: `Cannot move ${PAPERS}/a to the trash` }]);
    expect(await h.fs.exists(`${PAPERS}/a/metadata.yaml`)).toBe(true);
    expect(h.logs.find((l) => l.message === "Paper trash failed")).toMatchObject({ level: "WARN", context: { id: "a" } });
  });
});
