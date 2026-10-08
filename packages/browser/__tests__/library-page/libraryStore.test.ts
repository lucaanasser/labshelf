import { LibraryStore, shallowEqual } from "../../src/library-page/state/libraryStore";

describe("LibraryStore", () => {
  it("fires select immediately and only when the slice changes", () => {
    const store = new LibraryStore();
    const seen: string[] = [];
    store.select((s) => s.query, (q) => seen.push(q));
    store.set({ query: "a" });
    store.set({ status: "done" });
    store.set({ query: "a" });
    store.set({ query: "b" });
    expect(seen).toEqual(["", "a", "b"]);
  });

  it("stops notifying after unsubscribe", () => {
    const store = new LibraryStore();
    let calls = 0;
    const off = store.select((s) => s.folder, () => calls++);
    off();
    store.set({ folder: "papers/x" });
    expect(calls).toBe(1);
  });

  it("returns a copy from get()", () => {
    const store = new LibraryStore();
    const a = store.get();
    (a as { query: string }).query = "mutated";
    expect(store.get().query).toBe("");
  });

  describe("selection", () => {
    const order = ["a", "b", "c", "d"];
    it("selectOnly replaces the selection and sets anchor + cursor", () => {
      const store = new LibraryStore();
      store.selectOnly("b");
      expect([...store.get().selected]).toEqual(["b"]);
      expect(store.get().anchor).toBe("b");
      expect(store.get().cursor).toBe("b");
    });
    it("toggleSelected adds and removes without touching others", () => {
      const store = new LibraryStore();
      store.selectOnly("a");
      store.toggleSelected("c");
      expect([...store.get().selected].sort()).toEqual(["a", "c"]);
      store.toggleSelected("a");
      expect([...store.get().selected]).toEqual(["c"]);
    });
    it("selectRange spans anchor..target in either direction", () => {
      const store = new LibraryStore();
      store.selectOnly("c");
      store.selectRange(order, "a");
      expect([...store.get().selected]).toEqual(["a", "b", "c"]);
      expect(store.get().cursor).toBe("a");
      expect(store.get().anchor).toBe("c");
    });
    it("selectRange falls back to selectOnly when the anchor is gone", () => {
      const store = new LibraryStore();
      store.selectOnly("zzz");
      store.selectRange(order, "b");
      expect([...store.get().selected]).toEqual(["b"]);
    });
    it("clearSelection is a no-op when nothing is selected", () => {
      const store = new LibraryStore();
      let calls = 0;
      store.select((s) => s.selected, () => calls++);
      store.clearSelection();
      expect(calls).toBe(1);
      store.selectOnly("a");
      store.clearSelection();
      expect(store.get().selected.size).toBe(0);
    });
    it("publishes a new Set instance so slice equality is a reference check", () => {
      const store = new LibraryStore();
      const before = store.get().selected;
      store.toggleSelected("a");
      expect(store.get().selected).not.toBe(before);
    });
  });

  describe("pdf presence slices", () => {
    it("starts with empty pdfDirs and pdfBusy sets", () => {
      const s = new LibraryStore().get();
      expect(s.pdfDirs.size).toBe(0);
      expect(s.pdfBusy.size).toBe(0);
    });
    it("fires a pdfDirs subscriber only when a new pdfDirs set is published", () => {
      const store = new LibraryStore();
      const sizes: number[] = [];
      store.select((s) => s.pdfDirs, (d) => sizes.push(d.size));
      store.set({ pdfDirs: new Set(["papers/A/a1"]) });
      store.set({ pdfBusy: new Set(["x"]) });   // unrelated slice must not re-fire pdfDirs
      expect(sizes).toEqual([0, 1]);
    });
    it("fires a pdfBusy subscriber when a new pdfBusy set is published", () => {
      const store = new LibraryStore();
      const sizes: number[] = [];
      store.select((s) => s.pdfBusy, (b) => sizes.push(b.size));
      store.set({ pdfBusy: new Set(["id1"]) });
      expect(sizes).toEqual([0, 1]);
    });
  });

  it("openFolder resets query, status tab and selection, and ignores the same folder", () => {
    const store = new LibraryStore();
    store.set({ query: "x", status: "done" });
    store.selectOnly("a");
    let calls = 0;
    store.select((s) => s.folder, () => calls++);
    store.openFolder("papers");
    expect(calls).toBe(1);
    expect(store.get().query).toBe("x");
    store.openFolder("papers/A");
    expect(store.get()).toMatchObject({ folder: "papers/A", query: "", status: "all", anchor: null, cursor: null });
    expect(store.get().selected.size).toBe(0);
  });
});

describe("shallowEqual", () => {
  it("compares primitives, arrays and plain objects one level deep", () => {
    expect(shallowEqual(1, 1)).toBe(true);
    expect(shallowEqual("a", "b")).toBe(false);
    expect(shallowEqual([1, 2], [1, 2])).toBe(true);
    expect(shallowEqual([1, 2], [1, 3])).toBe(false);
    expect(shallowEqual({ a: 1 }, { a: 1 })).toBe(true);
    expect(shallowEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(shallowEqual({ a: {} }, { a: {} })).toBe(false);
  });
  it("treats Sets and arrays-vs-objects by reference only", () => {
    const s = new Set([1]);
    expect(shallowEqual(s, s)).toBe(true);
    expect(shallowEqual(new Set([1]), new Set([1]))).toBe(false);
    expect(shallowEqual([], {})).toBe(false);
    expect(shallowEqual(null, {})).toBe(false);
  });
});
