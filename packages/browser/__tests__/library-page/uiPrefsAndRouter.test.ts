import { DEFAULT_PREFS, PREFS_KEY, loadPrefs, sanitize, savePrefs } from "../../src/library-page/state/uiPrefs";
import { folderFromHash, hashForFolder } from "../../src/library-page/router";

class MemoryStorage implements Pick<Storage, "getItem" | "setItem"> {
  private map = new Map<string, string>();
  getItem(k: string): string | null { return this.map.get(k) ?? null; }
  setItem(k: string, v: string): void { this.map.set(k, v); }
}

describe("uiPrefs", () => {
  it("returns defaults for missing or corrupt storage", () => {
    const storage = new MemoryStorage();
    expect(loadPrefs(storage)).toEqual(DEFAULT_PREFS);
    storage.setItem(PREFS_KEY, "{not json");
    expect(loadPrefs(storage)).toEqual(DEFAULT_PREFS);
  });

  it("validates every field and clamps widths", () => {
    const prefs = sanitize({
      sortKey: "bogus", sortDir: -1, includeSub: "yes", detailWidth: 9999, sidebarWidth: 10,
      detailCollapsed: true, secCollapsed: { info: true, notes: "x" }, treeExpanded: ["papers/A", 5],
    });
    expect(prefs).toMatchObject({
      sortKey: "title", sortDir: -1, includeSub: true, detailWidth: 620, sidebarWidth: 160,
      detailCollapsed: true, secCollapsed: DEFAULT_PREFS.secCollapsed, treeExpanded: ["papers/A"],
    });
  });

  it("merges patches into the stored value", () => {
    const storage = new MemoryStorage() as unknown as Storage;
    savePrefs({ sortKey: "year", sortDir: -1 }, storage);
    savePrefs({ includeSub: false }, storage);
    expect(loadPrefs(storage)).toMatchObject({ sortKey: "year", sortDir: -1, includeSub: false, detailWidth: 272 });
  });
});

describe("router hash <-> folder", () => {
  it("round-trips folders, encoding each segment", () => {
    for (const f of ["papers", "papers/A", "papers/Reading group/Refs & notes"]) {
      expect(folderFromHash(hashForFolder(f))).toBe(f);
    }
    expect(hashForFolder("papers/Reading group")).toBe("#/papers/Reading%20group");
  });
  it("falls back to the root for empty, foreign or traversal hashes", () => {
    for (const h of ["", "#", "#/", "#/elsewhere", "#/papers-old/x", "#/papers/../x", "#/papers//x", "#/papers/./x"]) {
      expect(folderFromHash(h)).toBe("papers");
    }
  });
  it("tolerates a trailing slash", () => {
    expect(folderFromHash("#/papers/A/")).toBe("papers/A");
  });
});
