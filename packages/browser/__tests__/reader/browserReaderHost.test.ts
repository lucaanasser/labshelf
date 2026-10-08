import type { PaperRecord } from "@labshelf/core";
import { DEFAULT_READER_PREFS, PaperDataStore, type HostToWebview, type SidecarPort } from "@labshelf/reader";
import { BrowserReaderHost, type ReaderHostDeps } from "../../src/reader/browserReaderHost";

const paper = { id: "p1", citeKey: "imai1986", title: "Efficient Algorithms", authors: ["Hiroshi Imai", "Takao Asano"], year: 1986, path: "papers/x/p1" } as unknown as PaperRecord;

function setup(seed?: string, page?: number) {
  const files: Record<string, string> = seed ? { p1: seed } : {};
  const port: SidecarPort = { read: async (id) => files[id] ?? null, write: async (id, t) => { files[id] = t; } };
  const posted: HostToWebview[] = [];
  const deps = {
    paper,
    store: new PaperDataStore(port, { now: () => "2026-10-07T00:00:00.000Z", newId: () => "a1" }),
    post: (m: HostToWebview) => posted.push(m),
    getPrefs: () => DEFAULT_READER_PREFS,
    autoTheme: () => "dark" as const,
    writeClipboard: jest.fn(async () => undefined),
    notify: jest.fn(),
    openExternal: jest.fn(async () => undefined),
    saveFile: jest.fn(async () => undefined),
    scheduleSync: jest.fn(),
    log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    now: () => 1000,
  } satisfies ReaderHostDeps;
  const host = new BrowserReaderHost(deps, page !== undefined ? { page } : {});
  return { host, deps, posted, files };
}

const sidecar = JSON.stringify({
  annotations: [
    { id: "b", paperId: "p1", type: "note", pageNumber: 2, content: "n", createdAt: "2026-01-02T00:00:00.000Z", updatedAt: "x" },
    { id: "a", paperId: "p1", type: "highlight", pageNumber: 1, content: "h", color: "blue", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "x" },
  ],
  theme: "sepia",
  reading: { page: 5, scaleValue: "page-width", updatedAt: "t" },
});

describe("BrowserReaderHost", () => {
  it("answers ready-for-init with the sidecar's theme, sorted annotations, reading position and prefs", async () => {
    const { host, posted } = setup(sidecar);
    await host.handle({ command: "ready-for-init" });
    expect(posted).toHaveLength(1);
    const init = posted[0] as Extract<HostToWebview, { type: "init" }>;
    expect(init).toMatchObject({ type: "init", theme: "sepia", effectiveTheme: "sepia", prefs: DEFAULT_READER_PREFS, reading: { page: 5 } });
    expect(init.annotations.map((a) => a.id)).toEqual(["a", "b"]);
  });

  it("resolves an 'auto' paper theme to the LabShelf theme and follows it", async () => {
    const { host, posted } = setup();
    await host.handle({ command: "ready-for-init" });
    expect(posted[0]).toMatchObject({ theme: "auto", effectiveTheme: "dark", reading: null });
    host.onAutoThemeChange("light");
    expect(posted[1]).toEqual({ type: "applyTheme", theme: "auto", effectiveTheme: "light" });
  });

  it("ignores LabShelf theme changes while the paper has its own theme", async () => {
    const { host, posted } = setup(sidecar);
    await host.handle({ command: "ready-for-init" });
    host.onAutoThemeChange("light");
    expect(posted).toHaveLength(1);
  });

  it("persists a chosen theme, applies it and schedules a sync; unknown themes are ignored", async () => {
    const { host, posted, files, deps } = setup();
    await host.handle({ command: "selectTheme", theme: "high-contrast" });
    expect(JSON.parse(files.p1!).theme).toBe("high-contrast");
    expect(posted.at(-1)).toEqual({ type: "applyTheme", theme: "high-contrast", effectiveTheme: "high-contrast" });
    expect(deps.scheduleSync).toHaveBeenCalledWith("reader.theme");
    await host.handle({ command: "selectTheme", theme: "neon" });
    expect(posted).toHaveLength(1);
  });

  it("creates, updates and deletes annotations in the sidecar and pushes the new list", async () => {
    const { host, posted, files, deps } = setup();
    await host.handle({ command: "createAnnotation", type: "highlight", pageNumber: 1, content: "quote", color: "green" });
    expect(JSON.parse(files.p1!).annotations[0]).toMatchObject({ id: "a1", type: "highlight", color: "green", pageNumber: 1 });
    expect(posted.at(-1)).toMatchObject({ type: "updateAnnotations" });
    await host.handle({ command: "updateAnnotation", id: "a1", content: "edited" });
    expect(JSON.parse(files.p1!).annotations[0].content).toBe("edited");
    await host.handle({ command: "deleteAnnotation", id: "a1" });
    expect(JSON.parse(files.p1!).annotations).toEqual([]);
    expect(deps.scheduleSync).toHaveBeenCalledTimes(3);
  });

  it("reports an invalid annotation as an error notice without writing", async () => {
    const { host, files, deps, posted } = setup();
    await host.handle({ command: "createAnnotation", type: "highlight", pageNumber: 1, content: "q", color: "purple" as never });
    expect(files.p1).toBeUndefined();
    expect(deps.notify).toHaveBeenCalledWith(expect.stringContaining("Failed to create annotation"), "error");
    expect(posted).toHaveLength(0);
  });

  it("saves a normalized reading state without triggering a sync, and drops a corrupt one", async () => {
    const { host, files, deps } = setup();
    await host.handle({ command: "saveReadingState", state: { page: 3, scaleValue: "1.25", top: 10, updatedAt: "t" } });
    expect(JSON.parse(files.p1!).reading).toEqual({ page: 3, scaleValue: "1.25", top: 10, updatedAt: "t" });
    await host.handle({ command: "saveReadingState", state: { page: -1 } });
    expect(JSON.parse(files.p1!).reading.page).toBe(3);
    expect(deps.scheduleSync).not.toHaveBeenCalled();
  });

  it("copies with a citation in the preferred style and confirms", async () => {
    const { host, deps } = setup();
    await host.handle({ command: "copyWithCitation", text: "some\nquote", pageNumber: 4 });
    expect(deps.writeClipboard).toHaveBeenCalledWith("> some quote\n\n[@imai1986, p. 4]");
    expect(deps.notify).toHaveBeenCalledWith("Copied with citation (@imai1986, p. 4)", "ok");
    await host.handle({ command: "copyText", text: "plain" });
    expect(deps.writeClipboard).toHaveBeenLastCalledWith("plain");
  });

  it("exports annotations to the clipboard or as a downloaded Markdown file", async () => {
    const { host, deps } = setup(sidecar);
    await host.handle({ command: "exportAnnotations", target: "clipboard" });
    expect((deps.writeClipboard.mock.calls[0] as unknown as [string])[0]).toContain("# Efficient Algorithms");
    await host.handle({ command: "exportAnnotations", target: "file" });
    expect(deps.saveFile).toHaveBeenCalledWith("imai1986-annotations.md", expect.stringContaining("## Page 1"));
  });

  it("opens only http(s) and mailto links", async () => {
    const { host, deps } = setup();
    await host.handle({ command: "openExternalLink", url: "https://doi.org/10.1137/0215022" });
    await host.handle({ command: "openExternalLink", url: "javascript:alert(1)" });
    await host.handle({ command: "openExternalLink", url: "file:///etc/passwd" });
    expect(deps.openExternal).toHaveBeenCalledTimes(1);
    expect(deps.log.warn).toHaveBeenCalledTimes(2);
  });

  it("drops malformed messages with a warning", async () => {
    const { host, deps, posted } = setup();
    await host.handle({ command: "deleteAnnotation", id: "" });
    await host.handle("nope");
    expect(posted).toHaveLength(0);
    expect(deps.log.warn).toHaveBeenCalledTimes(2);
  });

  it("turns a storage failure into an error notice instead of a rejection", async () => {
    const { host, deps } = setup();
    (deps.store as unknown as { load: () => Promise<never> }).load = async () => { throw new Error("IDB closed"); };
    await expect(host.handle({ command: "ready-for-init" })).resolves.toBeUndefined();
    expect(deps.notify).toHaveBeenCalledWith("Reader action failed: IDB closed", "error");
  });

  it("holds a requested page until the document is laid out", async () => {
    const { host, posted } = setup(undefined, 7);
    await host.handle({ command: "ready", totalPages: 17 });
    expect(posted).toEqual([{ type: "scrollToPage", pageNumber: 7 }]);
    host.requestPage(2);
    expect(posted.at(-1)).toEqual({ type: "scrollToPage", pageNumber: 2 });
    host.requestPage(0);
    expect(posted).toHaveLength(2);
  });

  it("pushes prefs changes and logs the open timeline", async () => {
    const { host, posted, deps } = setup();
    host.onPrefsChange({ ...DEFAULT_READER_PREFS, vimKeys: true });
    expect(posted[0]).toEqual({ type: "prefsChanged", prefs: { ...DEFAULT_READER_PREFS, vimKeys: true } });
    await host.handle({ command: "perf", timeline: { scriptStart: 1 }, pageNumber: 1, theme: "dark", dpr: 2, canvas: "10x10" });
    expect(deps.log.info).toHaveBeenCalledWith("PDF open timeline", expect.objectContaining({ paperId: "p1", hostMs: 0 }));
    await host.handle({ command: "pageChanged", pageNumber: 9 });
    expect(host.page).toBe(9);
  });

  it("refreshes annotations after a sync only when they changed", async () => {
    const { host, posted, files } = setup(sidecar);
    await host.handle({ command: "ready-for-init" });
    await host.handle({ command: "ready", totalPages: 3 });
    await host.refreshAnnotations();
    expect(posted).toHaveLength(1);
    const data = JSON.parse(files.p1!);
    data.annotations.push({ id: "c", paperId: "p1", type: "note", pageNumber: 3, content: "from VS Code", createdAt: "2026-01-03T00:00:00.000Z", updatedAt: "x" });
    files.p1 = JSON.stringify(data);
    await host.refreshAnnotations();
    expect(posted.at(-1)).toMatchObject({ type: "updateAnnotations" });
    expect((posted.at(-1) as { annotations: unknown[] }).annotations).toHaveLength(3);
  });
});
