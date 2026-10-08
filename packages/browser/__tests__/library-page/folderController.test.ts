jest.mock("../../src/storage", () => ({ createLibraryMutations: () => ({}) }));
jest.mock("../../src/platform/logger", () => ({ BrowserLogger: class {} }));
jest.mock("../../src/ui/dialog", () => ({ confirmDialog: async () => false }));
jest.mock("../../src/ui/quickInput", () => ({ inputBox: async () => undefined }));
jest.mock("../../src/ui/toast", () => ({ toast: () => undefined }));
jest.mock("../../src/library-page/controllers/dataController", () => ({
  errorMessage: String,
  refreshLibrary: async () => undefined,
  scheduleSyncSoon: () => undefined,
}));

import { folderNameProblem } from "../../src/library-page/controllers/folderController";
import { LibraryStore } from "../../src/library-page/state/libraryStore";
import type { PaperRecord } from "@labshelf/core";

function storeWith(folders: string[], papers: Partial<PaperRecord>[] = []): LibraryStore {
  const store = new LibraryStore();
  store.set({
    folders: folders.map((name) => ({ name, path: `papers/${name}`, children: [] })),
    papers: papers as PaperRecord[],
  });
  return store;
}

describe("folderNameProblem", () => {
  const store = storeWith(["Thesis"], [{ id: "p", path: "papers/Taken" }]);

  it("accepts a fresh name", () => {
    expect(folderNameProblem(store, "papers", "Reading group")).toBeNull();
  });

  it.each(["", "..", ".hidden", "a/b", "a\\b", "bad\u0001name", "a".repeat(256)])("shows the core message for %j", (name) => {
    expect(folderNameProblem(store, "papers", name)).toEqual(expect.any(String));
  });

  it("rejects a control character with the core message", () => {
    expect(folderNameProblem(store, "papers", "bad\u0001name")).toBe("The name contains control characters.");
  });

  it("rejects a sibling name in any casing and a name a paper uses", () => {
    expect(folderNameProblem(store, "papers", "thesis")).toBe('A folder named "thesis" already exists here.');
    expect(folderNameProblem(store, "papers", "Taken")).toBe("A paper already uses that name here.");
  });

  it("allows keeping the current name on rename", () => {
    expect(folderNameProblem(store, "papers", "Thesis", "Thesis")).toBeNull();
  });
});
