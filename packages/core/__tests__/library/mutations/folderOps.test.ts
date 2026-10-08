import { createFolder, moveFolder, renameFolder, trashFolder } from "@labshelf/core";

import { makeHarness, PAPERS } from "../../support/mutationHarness";

const ML = `${PAPERS}/ML`;
const BIO = `${PAPERS}/Bio`;

describe("createFolder", () => {
  it("creates a folder at the root and below another folder, returning its path", async () => {
    const h = makeHarness();
    expect(await createFolder(h.ctx, PAPERS, "ML")).toBe(ML);
    expect(await createFolder(h.ctx, ML, "Vision")).toBe(`${ML}/Vision`);
    expect((await h.fs.stat(`${ML}/Vision`))?.isDirectory).toBe(true);
  });

  it("trims the name", async () => {
    const h = makeHarness();
    expect(await createFolder(h.ctx, PAPERS, "  Spaced  ")).toBe(`${PAPERS}/Spaced`);
  });

  it.each([
    ["", "The name cannot be empty."],
    ["a/b", "Use a name without slashes."],
    [".secret", "A collection name cannot start with a dot."],
  ])("rejects %j", async (name, message) => {
    const h = makeHarness();
    await expect(createFolder(h.ctx, PAPERS, name)).rejects.toThrow(message);
    expect(await h.fs.listDir(PAPERS)).toEqual([]);
  });

  it("rejects a name that already exists", async () => {
    const h = makeHarness();
    await h.fs.mkdir(ML);
    await expect(createFolder(h.ctx, PAPERS, "ML")).rejects.toThrow('"ML" already exists');
  });
});

describe("renameFolder", () => {
  it("renames the folder with everything in it", async () => {
    const h = makeHarness();
    await h.seedPaper(`${ML}/Vision/p1`, { title: "1" });
    expect(await renameFolder(h.ctx, ML, "Machine Learning")).toBe(`${PAPERS}/Machine Learning`);
    expect(await h.fs.exists(`${PAPERS}/Machine Learning/Vision/p1/metadata.yaml`)).toBe(true);
    expect(await h.fs.exists(ML)).toBe(false);
  });

  it("allows a rename that only changes letter case, where the disk finds the folder itself", async () => {
    const h = makeHarness();
    await h.fs.mkdir(`${PAPERS}/ml`);
    const exists = h.fs.exists.bind(h.fs);
    h.fs.exists = async (target) => exists(target) || exists(target.toLowerCase());
    expect(await renameFolder(h.ctx, `${PAPERS}/ml`, "ML")).toBe(ML);
    expect(h.fs.renames).toEqual([[`${PAPERS}/ml`, ML]]);
  });

  it("is a no-op when the name does not change", async () => {
    const h = makeHarness();
    await h.fs.mkdir(ML);
    expect(await renameFolder(h.ctx, ML, "ML")).toBe(ML);
    expect(h.fs.renames).toEqual([]);
  });

  it("rejects the library root, invalid names and clashes (BC17 wording)", async () => {
    const h = makeHarness();
    await h.fs.mkdir(ML);
    await h.fs.mkdir(BIO);
    await expect(renameFolder(h.ctx, PAPERS, "X")).rejects.toThrow("The library root cannot be renamed");
    await expect(renameFolder(h.ctx, ML, "")).rejects.toThrow("The name cannot be empty.");
    await expect(renameFolder(h.ctx, ML, "a/b")).rejects.toThrow("Use a name without slashes.");
    await expect(renameFolder(h.ctx, ML, "Bio")).rejects.toThrow('"Bio" already exists there');
    expect(h.fs.renames).toEqual([]);
  });
});

describe("moveFolder", () => {
  it("moves a folder with everything in it under another folder", async () => {
    const h = makeHarness();
    await h.seedPaper(`${ML}/Vision/p1`, { title: "1" });
    await h.fs.mkdir(BIO);
    expect(await moveFolder(h.ctx, `${ML}/Vision`, BIO)).toBe(`${BIO}/Vision`);
    expect(await h.fs.exists(`${BIO}/Vision/p1/paper.pdf`)).toBe(true);
    expect(await h.fs.exists(`${ML}/Vision`)).toBe(false);
  });

  it("moves a folder to the library root", async () => {
    const h = makeHarness();
    await h.fs.mkdir(`${ML}/Vision`);
    expect(await moveFolder(h.ctx, `${ML}/Vision`, PAPERS)).toBe(`${PAPERS}/Vision`);
  });

  it("does nothing, without an error, when the folder is already in that parent (BC15)", async () => {
    const h = makeHarness();
    await h.fs.mkdir(`${ML}/Vision`);
    expect(await moveFolder(h.ctx, `${ML}/Vision`, ML)).toBe(`${ML}/Vision`);
    expect(h.fs.renames).toEqual([]);
  });

  it("refuses to move a folder into itself or into its own descendant", async () => {
    const h = makeHarness();
    await h.fs.mkdir(`${ML}/Vision`);
    await expect(moveFolder(h.ctx, ML, ML)).rejects.toThrow("A folder cannot be moved into itself.");
    await expect(moveFolder(h.ctx, ML, `${ML}/Vision`)).rejects.toThrow("A folder cannot be moved into itself.");
    expect(h.fs.renames).toEqual([]);
  });

  it("allows moving into a folder whose name merely starts with the same letters", async () => {
    const h = makeHarness();
    await h.fs.mkdir(ML);
    await h.fs.mkdir(`${PAPERS}/ML2`);
    expect(await moveFolder(h.ctx, ML, `${PAPERS}/ML2`)).toBe(`${PAPERS}/ML2/ML`);
  });

  it("rejects the library root and a name clash (BC17 wording)", async () => {
    const h = makeHarness();
    await h.fs.mkdir(`${ML}/Vision`);
    await h.fs.mkdir(`${BIO}/Vision`);
    await expect(moveFolder(h.ctx, PAPERS, BIO)).rejects.toThrow("The library root cannot be moved");
    await expect(moveFolder(h.ctx, `${ML}/Vision`, BIO)).rejects.toThrow('"Vision" already exists there');
  });
});

describe("trashFolder", () => {
  it("trashes the folder with its papers", async () => {
    const h = makeHarness();
    await h.seedPaper(`${ML}/p1`, { title: "1" });
    await trashFolder(h.ctx, ML);
    expect(h.fs.trashed).toEqual([ML]);
    expect(await h.fs.exists(`${ML}/p1/metadata.yaml`)).toBe(false);
  });

  it("passes a trash failure on and deletes nothing", async () => {
    const h = makeHarness();
    await h.seedPaper(`${ML}/p1`, { title: "1" });
    h.fs.trashFails.add(ML);
    await expect(trashFolder(h.ctx, ML)).rejects.toThrow(`Cannot move ${ML} to the trash`);
    expect(await h.fs.exists(`${ML}/p1/metadata.yaml`)).toBe(true);
  });

  it("refuses to trash the library root", async () => {
    const h = makeHarness();
    await expect(trashFolder(h.ctx, PAPERS)).rejects.toThrow("The library root cannot be deleted");
    expect(h.fs.trashed).toEqual([]);
  });
});
