import { promises as fs, readFileSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import osModule from "node:os";
import * as path from "node:path";

import { parse as parseYaml } from "yaml";

import { openLibrary, type AppContext } from "../../src/app/context";
import * as system from "../../src/platform/system";
import type { InputEvent } from "../../src/tui/input";
import type { Screen } from "../../src/tui/screen";
import type { TerminalSize } from "../../src/tui/terminal";
import { ALL, App, completePath, syncSegment, type TerminalLike } from "../../src/ui/app";
import { helpRows } from "../../src/ui/overlays";
import { computeLayout } from "../../src/ui/render";
import { theme } from "../../src/ui/theme";

// Everything that would reach outside the temporary library (viewers, the clipboard, the file manager, $EDITOR and,
// above all, the real trash) is replaced; the tests assert on the calls instead.
jest.mock("../../src/platform/system", () => ({
  ...jest.requireActual<typeof import("../../src/platform/system")>("../../src/platform/system"),
  openExternal: jest.fn(),
  revealInFileManager: jest.fn(),
  copyToClipboard: jest.fn(),
  runEditor: jest.fn(),
  trashSupported: jest.fn(),
  moveToTrash: jest.fn(),
}));

const mocked = {
  openExternal: jest.mocked(system.openExternal),
  revealInFileManager: jest.mocked(system.revealInFileManager),
  copyToClipboard: jest.mocked(system.copyToClipboard),
  runEditor: jest.mocked(system.runEditor),
  trashSupported: jest.mocked(system.trashSupported),
  moveToTrash: jest.mocked(system.moveToTrash),
};

// ───────────────────────────── harness ─────────────────────────────

class FakeTerminal implements TerminalLike {
  frames: Screen[] = [];
  raw: string[] = [];
  left = 0;
  size(): TerminalSize { return { cols: 120, rows: 30 }; }
  listen(): void { /* never called: the tests drive handle() directly */ }
  enter(): void { /* nothing to take over */ }
  leave(): void { this.left++; }
  draw(frame: Screen): void { this.frames.push(frame); }
  invalidate(): void { /* nothing to repaint */ }
  writeRaw(data: string): void { this.raw.push(data); }
  suspend<T>(run: () => T): T { return run(); }
  stopJob(): void { /* no job control in tests */ }
}

interface PaperSpec {
  id: string;
  folder: string;
  title: string;
  authors?: string[];
  year?: number;
  status?: "unread" | "reading" | "done";
  tags?: string[];
  doi?: string;
  summary?: string;
  note?: string;
  pdf: boolean;
}

// Titles sort as: Attention, BERT, Gradient, On the Electrodynamics, Zebra.
const PAPERS: PaperSpec[] = [
  {
    id: "vaswani2017attention", folder: "ML/Transformers", title: "Attention Is All You Need",
    authors: ["Ashish Vaswani", "Noam Shazeer"], year: 2017, status: "unread", tags: ["nlp", "transformers"],
    doi: "10.5555/3295222.3295349", summary: "The dominant sequence transduction models are based on complex recurrent or convolutional neural networks.", pdf: true,
  },
  {
    id: "devlin2019bert", folder: "ML/Transformers", title: "BERT: Pre-training of Deep Bidirectional Transformers",
    authors: ["Jacob Devlin"], year: 2019, status: "reading", pdf: true,
  },
  {
    id: "lecun1998gradient", folder: "ML", title: "Gradient-Based Learning Applied to Document Recognition",
    authors: ["Yann LeCun"], year: 1998, status: "done", pdf: true,
  },
  {
    id: "einstein1905electrodynamics", folder: "Physics", title: "On the Electrodynamics of Moving Bodies",
    authors: ["Albert Einstein"], year: 1905, status: "done", pdf: false,
  },
  {
    id: "zebra2020study", folder: "", title: "Zebra Study of Stripes",
    authors: ["Zoe Zebra"], year: 2020, status: "unread", note: "Check the stripes", pdf: true,
  },
];

const ATTENTION = "vaswani2017attention";
const BERT = "devlin2019bert";
// "bert" alone would also match the author "Albert Einstein".
const BERT_QUERY = "bidirectional";
const LECUN = "lecun1998gradient";
const EINSTEIN = "einstein1905electrodynamics";
const ZEBRA = "zebra2020study";

function yamlOf(spec: PaperSpec): string {
  const lines = [`title: ${JSON.stringify(spec.title)}`];
  if (spec.authors) { lines.push("authors:", ...spec.authors.map((a) => `  - ${JSON.stringify(a)}`)); }
  if (spec.year !== undefined) { lines.push(`year: ${spec.year}`); }
  lines.push(`citekey: ${spec.id}`, `status: ${spec.status ?? "unread"}`);
  if (spec.tags) { lines.push("tags:", ...spec.tags.map((t) => `  - ${JSON.stringify(t)}`)); }
  if (spec.doi) { lines.push(`doi: ${JSON.stringify(spec.doi)}`); }
  if (spec.summary) { lines.push(`summary: ${JSON.stringify(spec.summary)}`); }
  if (spec.note) { lines.push(`note: ${JSON.stringify(spec.note)}`); }
  return lines.join("\n") + "\n";
}

async function writeFile(file: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
}

async function writePaper(spec: PaperSpec): Promise<void> {
  const dir = paperDir(spec.folder, spec.id);
  await writeFile(path.join(dir, "metadata.yaml"), yamlOf(spec));
  if (spec.pdf) { await writeFile(path.join(dir, "paper.pdf"), "%PDF-1.4\n% LabShelf test fixture\n"); }
}

const papersDir = (): string => path.join(root, "papers");
const folderDir = (folder: string): string => path.join(papersDir(), ...folder.split("/").filter(Boolean));
const paperDir = (folder: string, id: string): string => path.join(folderDir(folder), id);
const folderOf = (id: string): string => PAPERS.find((p) => p.id === id)!.folder;

async function readMeta(folder: string, id: string): Promise<Record<string, unknown>> {
  return parseYaml(await fs.readFile(path.join(paperDir(folder, id), "metadata.yaml"), "utf8")) as Record<string, unknown>;
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.stat(target);
    return true;
  } catch {
    return false;
  }
}

async function writeSidecar(id: string, annotations: unknown[]): Promise<void> {
  await writeFile(path.join(root, ".research", "papers", id, "data.json"), JSON.stringify({ annotations, theme: "auto" }));
}

function highlight(id: string, pageNumber: number, content: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: `h-${pageNumber}`, paperId: id, type: "highlight", pageNumber, content, color: "yellow",
    position: { x: 0.1, y: 0.1, width: 0.5, height: 0.05 },
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", ...extra,
  };
}

async function openApp(): Promise<void> {
  ctx = await openLibrary(root, {
    config: { version: 1 },
    watch: false,
    thumbnailWorkerUrl: new URL("file:///unused/thumbnailWorker.mjs"),
    env: { ...process.env, XDG_CONFIG_HOME: tmp, XDG_CACHE_HOME: tmp, LABSHELF_TOKEN_STORE: "file", LABSHELF_IMAGES: "off" },
  });
  term = new FakeTerminal();
  app = new App(ctx, term);
}

let tmp: string;
let root: string;
let ctx: AppContext;
let term: FakeTerminal;
let app: App;

beforeEach(async () => {
  mocked.openExternal.mockReset();
  mocked.revealInFileManager.mockReset();
  mocked.copyToClipboard.mockReset().mockResolvedValue("system");
  mocked.runEditor.mockReset().mockReturnValue(true);
  mocked.trashSupported.mockReset().mockReturnValue(true);
  mocked.moveToTrash.mockReset().mockRejectedValue(new Error("the real trash must never be used by the tests"));
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "labshelf-app-"));
  root = path.join(tmp, "library");
  for (const spec of PAPERS) { await writePaper(spec); }
  await fs.mkdir(folderDir("Empty"), { recursive: true });
  await openApp();
});

afterEach(async () => {
  // Let background work (tasks, the log) finish before the folder disappears.
  await eventually(() => app.tasks.size === 0, "background tasks to finish at the end of the test").catch(() => undefined);
  await ctx.logger.log("INFO", "test", "done");
  await ctx.dispose();
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("suspending with Ctrl-Z", () => {
  it("is refused while a sync runs (the lock would be held by a stopped process)", () => {
    const stopJob = jest.spyOn(term, "stopJob");
    jest.spyOn(ctx.sync, "status").mockReturnValue({ state: "syncing" });
    press("C-z");
    expect(stopJob).not.toHaveBeenCalled();
    expect(app.message?.text).toContain("Wait for the sync");
  });

  it("suspends otherwise", () => {
    const stopJob = jest.spyOn(term, "stopJob");
    press("C-z");
    expect(stopJob).toHaveBeenCalledTimes(1);
  });
});

function keyEvent(id: string): InputEvent {
  if (id === "space") { return { type: "key", id, text: " " }; }
  if ([...id].length === 1) { return { type: "key", id, text: id }; }
  return { type: "key", id };
}

function press(...ids: string[]): void {
  for (const id of ids) { app.handle(keyEvent(id)); }
}

function typeText(text: string): void {
  for (const ch of text) { press(ch === " " ? "space" : ch); }
}

function click(x: number, y: number, button = 0): void {
  app.handle({ type: "mouse", kind: "down", button, x, y });
}

function wheel(kind: "wheel-up" | "wheel-down", x: number, y: number): void {
  app.handle({ type: "mouse", kind, button: 0, x, y });
}

async function eventually(check: () => boolean | Promise<boolean>, what: string, timeoutMs = 2500): Promise<void> {
  const started = Date.now();
  for (;;) {
    if (await check()) { return; }
    if (Date.now() - started > timeoutMs) {
      throw new Error(`Timed out waiting for ${what}.\nScreen:\n${app.frame().screen.toText()}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

// Waits for the background task a key press just started (tasks are registered synchronously).
async function idle(): Promise<void> {
  await eventually(() => app.tasks.size === 0, "background tasks to finish");
}

const screenText = (): string => app.frame().screen.toText();

// The text of one pane (or of the header / status bar). Only valid for the ASCII-and-box-drawing content used here,
// where every character takes exactly one cell.
function pane(which: "header" | "folders" | "papers" | "preview" | "status"): string {
  const rect = computeLayout(120, 30, app.focus)[which];
  if (!rect) { return ""; }
  const screen = app.frame().screen;
  const rows: string[] = [];
  for (let y = rect.y; y < rect.y + rect.h; y++) { rows.push(screen.rowText(y).slice(rect.x, rect.x + rect.w).trimEnd()); }
  return rows.join("\n");
}

const hoveredId = (): string | undefined => app.hoveredPaper()?.record.id;
const ids = (): string[] => app.papers().map((p) => p.record.id);

// The folders pane rows are: All papers, Unfiled, Empty, ML, ML/Transformers, Physics.
function goToFolder(folder: string): void {
  const rows = app.folderRows().map((row) => row.key);
  const target = rows.indexOf(folder);
  if (target < 0) { throw new Error(`no such folder row: ${folder}`); }
  press("h");
  press("g", "g");
  for (let i = 0; i < target; i++) { press("j"); }
}

// ───────────────────────────── tests ─────────────────────────────

describe("App initial frame", () => {
  it("shows the header, the folders, the papers and the preview of the first paper", () => {
    const text = screenText();
    expect(pane("header")).toContain("LabShelf");
    expect(pane("header")).toContain("All papers");
    expect(pane("header")).toContain("library");
    for (const folder of ["All papers", "Unfiled", "Empty", "ML", "Transformers", "Physics"]) {
      expect(pane("folders")).toContain(folder);
    }
    for (const title of ["Attention Is All You Need", "BERT: Pre-training", "Gradient-Based Learning", "On the Electrodynamics", "Zebra Study of Stripes"]) {
      expect(pane("papers")).toContain(title);
    }
    expect(pane("preview")).toContain("Attention Is All You Need");
    expect(pane("preview")).toContain("Status ○ unread");
    expect(text).toContain("NORMAL");
  });

  it("starts on All papers with focus on the papers and nothing selected", () => {
    expect(app.focus).toBe("papers");
    expect(app.folder).toBe(ALL);
    expect(app.search).toBeUndefined();
    expect(app.filter).toBe("");
    expect(app.flatten).toBe(false);
    expect(app.selection.size).toBe(0);
    expect(app.previewTab).toBe(0);
    expect(app.overlay).toBeUndefined();
    expect(app.inline).toBeUndefined();
  });

  it("sorts the papers by title and hovers the first one", () => {
    expect(ids()).toEqual([ATTENTION, BERT, LECUN, EINSTEIN, ZEBRA]);
    expect(hoveredId()).toBe(ATTENTION);
    expect(pane("status")).toContain("1/5");
    expect(pane("status")).toContain("title↑");
  });

  it("lists All papers, Unfiled and then the folder tree with counts", () => {
    expect(app.folderRows()).toEqual([
      { key: ALL, label: "All papers", depth: 0, count: 5, pseudo: true },
      { key: "", label: "Unfiled", depth: 0, count: 1, pseudo: true },
      { key: "Empty", label: "Empty", depth: 0, count: 0 },
      { key: "ML", label: "ML", depth: 0, count: 3 },
      { key: "ML/Transformers", label: "Transformers", depth: 1, count: 2 },
      { key: "Physics", label: "Physics", depth: 0, count: 1 },
    ]);
  });

  it("shows the sync state and the help hint in the status bar", () => {
    expect(pane("status")).toContain("Drive:");
    expect(pane("status")).toContain("? help");
  });

  it("marks papers without a PDF on this device in the Info tab", () => {
    press("G", "k");
    expect(hoveredId()).toBe(EINSTEIN);
    expect(pane("preview")).toContain("PDF    not on this device");
  });

  it("draws a frame on the terminal after every input event", () => {
    const before = term.frames.length;
    press("j");
    expect(term.frames.length).toBe(before + 1);
    expect(term.frames[term.frames.length - 1]!.toText()).toBe(screenText());
    press("k");
    expect(term.frames.length).toBe(before + 2);
  });

  it("replaces every OS-level side effect, so the tests cannot open viewers or touch the trash", () => {
    expect(jest.isMockFunction(system.openExternal)).toBe(true);
    expect(jest.isMockFunction(system.copyToClipboard)).toBe(true);
    expect(jest.isMockFunction(system.moveToTrash)).toBe(true);
  });
});

describe("App papers pane navigation", () => {
  it("moves the cursor with j and k", () => {
    press("j");
    expect(hoveredId()).toBe(BERT);
    expect(pane("status")).toContain("2/5");
    expect(pane("preview")).toContain("BERT: Pre-training of Deep Bidirectional");
    press("k");
    expect(hoveredId()).toBe(ATTENTION);
  });

  it("accepts the arrow keys", () => {
    press("down", "down");
    expect(hoveredId()).toBe(LECUN);
    press("up");
    expect(hoveredId()).toBe(BERT);
  });

  it("stops at the first and the last paper", () => {
    press("k", "k");
    expect(hoveredId()).toBe(ATTENTION);
    press("G", "j", "j");
    expect(hoveredId()).toBe(ZEBRA);
    expect(pane("status")).toContain("5/5");
  });

  it("jumps with G and gg", () => {
    press("G");
    expect(hoveredId()).toBe(ZEBRA);
    press("g", "g");
    expect(hoveredId()).toBe(ATTENTION);
    press("end");
    expect(hoveredId()).toBe(ZEBRA);
    press("home");
    expect(hoveredId()).toBe(ATTENTION);
  });

  it("moves by half pages and pages, clamped to the list", () => {
    press("C-d");
    expect(hoveredId()).toBe(ZEBRA);
    press("C-u");
    expect(hoveredId()).toBe(ATTENTION);
    press("pagedown");
    expect(hoveredId()).toBe(ZEBRA);
    press("pageup");
    expect(hoveredId()).toBe(ATTENTION);
  });

  it("shows which key sequences can follow a prefix while one is pending", () => {
    press("g");
    expect(app.pending).toEqual(["g"]);
    expect(pane("status")).toContain("g →");
    press("g");
    expect(app.pending).toEqual([]);
    press("m");
    expect(app.pending).toEqual(["m"]);
    expect(pane("status")).toContain("m →");
    expect(pane("status")).toContain("unread");
    expect(pane("status")).toContain("reading");
    expect(pane("status")).toContain("done");
  });

  it("goes back to All papers with ga", () => {
    goToFolder("Physics");
    press("l");
    expect(app.folder).toBe("Physics");
    press("g", "a");
    expect(app.folder).toBe(ALL);
    expect(app.focus).toBe("papers");
  });

  it("scrolls the preview with J and K and resets the scroll when the paper changes", () => {
    press("J");
    expect(app.previewScroll).toBe(3);
    expect(pane("preview")).not.toContain("Attention Is All You Need");
    press("K");
    expect(app.previewScroll).toBe(0);
    press("K");
    expect(app.previewScroll).toBe(0);
    expect(pane("preview")).toContain("Attention Is All You Need");
    press("J", "j");
    expect(app.previewScroll).toBe(0);
  });
});

describe("App folders pane", () => {
  it("moves focus to the folders with h and back to the papers with l", () => {
    press("h");
    expect(app.focus).toBe("folders");
    expect(pane("status")).toContain("folder 1/6");
    press("l");
    expect(app.focus).toBe("papers");
  });

  it("selects a folder with j and the papers pane follows", () => {
    press("h", "j");
    expect(app.folder).toBe("");
    expect(pane("papers")).toContain("Zebra Study of Stripes");
    expect(pane("papers")).not.toContain("Attention Is All You Need");
    press("j");
    expect(app.folder).toBe("Empty");
    expect(pane("papers")).toContain("No papers here.");
    press("j");
    expect(app.folder).toBe("ML");
    expect(pane("papers")).toContain("Gradient-Based Learning");
    expect(pane("papers")).not.toContain("Attention Is All You Need");
    press("j");
    expect(app.folder).toBe("ML/Transformers");
    expect(pane("papers")).toContain("Attention Is All You Need");
    expect(pane("papers")).toContain("BERT: Pre-training");
    expect(pane("papers")).not.toContain("Gradient-Based Learning");
    expect(pane("status")).toContain("folder 5/6");
  });

  it("shows the hovered folder's summary in the preview", () => {
    press("h", "j", "j", "j");
    expect(app.folder).toBe("ML");
    const preview = pane("preview");
    expect(preview).toContain("3 papers · 1 subfolder");
    expect(preview).toContain("Transformers/ 2");
    expect(preview).toContain("Gradient-Based Learning");
  });

  it("shows a library overview in the preview while All papers is hovered", () => {
    press("h");
    const preview = pane("preview");
    expect(preview).toContain("Library");
    expect(preview).toContain("5 papers");
    expect(preview).toContain("4 with PDF");
  });

  it("moves back up with k and stops at the ends", () => {
    press("h", "j", "j", "k");
    expect(app.folder).toBe("");
    press("k", "k");
    expect(app.folder).toBe(ALL);
    press("G");
    expect(app.folder).toBe("Physics");
    press("j");
    expect(app.folder).toBe("Physics");
    press("g", "g");
    expect(app.folder).toBe(ALL);
  });

  it("climbs to the parent folder with h and ends at All papers", () => {
    goToFolder("ML/Transformers");
    expect(app.folder).toBe("ML/Transformers");
    press("h");
    expect(app.folder).toBe("ML");
    press("h");
    expect(app.folder).toBe(ALL);
    press("h");
    expect(app.folder).toBe(ALL);
    expect(app.focus).toBe("folders");
  });

  it("lands on the first paper of the folder when returning to the papers pane", () => {
    goToFolder("ML/Transformers");
    press("l");
    expect(app.focus).toBe("papers");
    expect(hoveredId()).toBe(ATTENTION);
  });

  it("shows the folder path in the header", () => {
    goToFolder("ML/Transformers");
    expect(pane("header")).toContain("ML › Transformers");
  });

  it("remembers the cursor of each folder", () => {
    goToFolder("ML/Transformers");
    press("l", "j");
    expect(hoveredId()).toBe(BERT);
    press("h", "k");
    expect(app.folder).toBe("ML");
    press("j");
    expect(app.folder).toBe("ML/Transformers");
    press("l");
    expect(hoveredId()).toBe(BERT);
  });

  it("toggles the papers of subfolders with a dot", () => {
    goToFolder("ML");
    press("l");
    expect(ids()).toEqual([LECUN]);
    press(".");
    expect(app.flatten).toBe(true);
    expect(ids()).toEqual([ATTENTION, BERT, LECUN]);
    expect(pane("header")).toContain("+ subfolders");
    expect(pane("status")).toContain("Including papers from subfolders");
    press(".");
    expect(app.flatten).toBe(false);
    expect(ids()).toEqual([LECUN]);
    expect(pane("header")).not.toContain("+ subfolders");
    expect(pane("status")).toContain("Showing only the papers directly in each folder");
  });

  it("names the folder each paper lives in when listing several folders at once", () => {
    expect(pane("papers")).toContain("Transformers");
    expect(pane("papers")).toContain("Physics");
    expect(pane("papers")).toContain("unfiled");
  });
});

describe("App folder history and jumps", () => {
  it("goes back and forward through the folders visited with H and L", () => {
    press(":");
    typeText("cd Physics");
    press("enter");
    expect(app.folder).toBe("Physics");
    press(":");
    typeText("cd ML");
    press("enter");
    expect(app.folder).toBe("ML");
    press("H");
    expect(app.folder).toBe("Physics");
    press("H");
    expect(app.folder).toBe(ALL);
    press("H");
    expect(app.folder).toBe(ALL);
    press("L");
    expect(app.folder).toBe("Physics");
    press("L");
    expect(app.folder).toBe("ML");
  });

  it("opens a folder picker with z and jumps to the chosen folder", () => {
    press("z");
    expect(app.overlay?.kind).toBe("picker");
    expect(screenText()).toContain("Jump to folder (6)");
    typeText("phys");
    expect(screenText()).toContain("Jump to folder (1)");
    press("enter");
    expect(app.overlay).toBeUndefined();
    expect(app.folder).toBe("Physics");
    expect(app.focus).toBe("papers");
  });

  it("matches folder names fuzzily, subfolders by their full path", () => {
    press("z");
    typeText("trns");
    press("enter");
    expect(app.folder).toBe("ML/Transformers");
  });

  it("moves through the picker with the arrow keys", () => {
    press("z", "down", "down", "enter");
    expect(app.folder).toBe("ML");
    press("z", "down", "down", "down", "up", "enter");
    expect(app.folder).toBe("ML");
  });

  it("includes All papers and the library root in the picker", () => {
    press("z");
    expect(screenText()).toContain("All papers");
    expect(screenText()).toContain("Library root (unfiled)");
    typeText("unfiled");
    press("enter");
    expect(app.folder).toBe("");
  });

  it("closes the picker with Esc without moving", () => {
    press("z", "esc");
    expect(app.overlay).toBeUndefined();
    expect(app.folder).toBe(ALL);
  });

  it("says when nothing matches in the picker", () => {
    press("z");
    typeText("qqqq");
    expect(screenText()).toContain("No match");
    press("enter");
    expect(app.folder).toBe(ALL);
  });

  it("jumps to a paper with Z and reveals it in its folder", () => {
    press("Z");
    expect(app.overlay?.kind).toBe("picker");
    expect(screenText()).toContain("Jump to paper (5)");
    typeText("bert");
    press("enter");
    expect(app.folder).toBe("ML/Transformers");
    expect(hoveredId()).toBe(BERT);
    expect(app.focus).toBe("papers");
  });
});

describe("App filter (f)", () => {
  it("filters the list live while typing and Esc restores it", () => {
    press("f");
    expect(app.inline?.purpose).toBe("filter");
    typeText(BERT_QUERY);
    expect(app.filter).toBe(BERT_QUERY);
    expect(ids()).toEqual([BERT]);
    expect(pane("papers")).not.toContain("Attention Is All You Need");
    expect(pane("status")).toContain("FILTER");
    press("esc");
    expect(app.inline).toBeUndefined();
    expect(app.filter).toBe("");
    expect(ids()).toHaveLength(5);
    expect(pane("papers")).toContain("Attention Is All You Need");
  });

  it("updates on every keystroke, including backspace", () => {
    press("f");
    let typedSoFar = "";
    for (const ch of BERT_QUERY) {
      typeText(ch);
      typedSoFar += ch;
      expect(app.filter).toBe(typedSoFar);
    }
    expect(ids()).toEqual([BERT]);
    for (let i = BERT_QUERY.length - 1; i >= 0; i--) {
      press("backspace");
      expect(app.filter).toBe(BERT_QUERY.slice(0, i));
    }
    expect(ids()).toHaveLength(5);
  });

  it("narrows the list as soon as the first letter is typed", () => {
    press("f");
    typeText("z");
    expect(ids().length).toBeLessThan(5);
    expect(ids()).toContain(ZEBRA);
  });

  it("keeps the filter on Enter and shows it in the status bar", () => {
    press("f");
    typeText(BERT_QUERY);
    press("enter");
    expect(app.inline).toBeUndefined();
    expect(app.filter).toBe(BERT_QUERY);
    expect(ids()).toEqual([BERT]);
    expect(pane("status")).toContain(`f: ${BERT_QUERY}`);
    expect(pane("status")).toContain("FILTER");
  });

  it("clears a kept filter with Esc in normal mode", () => {
    press("f");
    typeText(BERT_QUERY);
    press("enter", "esc");
    expect(app.filter).toBe("");
    expect(ids()).toHaveLength(5);
  });

  it("restores the previous filter, not an empty one, when editing is cancelled", () => {
    press("f");
    typeText(BERT_QUERY);
    press("enter", "f");
    expect(app.inline?.input.value).toBe(BERT_QUERY);
    typeText("zzz");
    expect(ids()).toEqual([]);
    press("esc");
    expect(app.filter).toBe(BERT_QUERY);
    expect(ids()).toEqual([BERT]);
  });

  it("explains an empty result", () => {
    press("f");
    typeText("zzzz");
    expect(ids()).toEqual([]);
    expect(pane("papers")).toContain("No paper matches the filter.");
    expect(pane("papers")).toContain("Esc clears it.");
  });

  it("understands the query language", () => {
    const filtered = (query: string): string[] => {
      press("f", "C-u");
      typeText(query);
      press("enter");
      const result = ids();
      press("esc");
      return result;
    };
    expect(filtered("tag:nlp")).toEqual([ATTENTION]);
    expect(filtered("status:reading")).toEqual([BERT]);
    expect(filtered("year:2019")).toEqual([BERT]);
    expect(filtered("year:1900..1999")).toEqual([LECUN, EINSTEIN]);
    expect(filtered("author:einstein")).toEqual([EINSTEIN]);
    expect(filtered("no:pdf")).toEqual([EINSTEIN]);
    expect(filtered("has:note")).toEqual([ZEBRA]);
    expect(filtered("has:doi")).toEqual([ATTENTION]);
    expect(filtered("transformers -bert")).toEqual([ATTENTION]);
  });

  it("clears the filter when another folder is chosen", () => {
    press("f");
    typeText(BERT_QUERY);
    press("enter");
    press("h", "j");
    expect(app.filter).toBe("");
  });

  it("moves the cursor with the arrow keys while typing", () => {
    press("f", "down");
    expect(hoveredId()).toBe(BERT);
    press("up");
    expect(hoveredId()).toBe(ATTENTION);
  });

  it("filters the folder being browsed", () => {
    goToFolder("ML");
    press("l", ".", "f");
    typeText(BERT_QUERY);
    expect(ids()).toEqual([BERT]);
  });

  it("accepts pasted text", () => {
    press("f");
    app.handle({ type: "paste", text: "tag:nlp\n" });
    expect(app.filter).toBe("tag:nlp ");
    expect(ids()).toEqual([ATTENTION]);
  });
});

describe("App find (/)", () => {
  it("jumps the cursor to the first match while typing without hiding other papers", () => {
    press("/");
    expect(app.inline?.purpose).toBe("find");
    typeText("gradient");
    expect(hoveredId()).toBe(LECUN);
    expect(ids()).toHaveLength(5);
    press("enter");
    expect(app.inline).toBeUndefined();
    expect(hoveredId()).toBe(LECUN);
  });

  it("steps through matches with n and N, wrapping around", () => {
    press("/");
    typeText("transformers");
    press("enter");
    expect(hoveredId()).toBe(ATTENTION);
    press("n");
    expect(hoveredId()).toBe(BERT);
    press("n");
    expect(hoveredId()).toBe(ATTENTION);
    press("N");
    expect(hoveredId()).toBe(BERT);
  });

  it("warns when there is no match", () => {
    press("/");
    typeText("zzzz");
    expect(app.message?.text).toBe('No match for "zzzz"');
    expect(app.message?.level).toBe("warn");
  });

  it("does nothing on n before anything was searched", () => {
    press("n");
    expect(hoveredId()).toBe(ATTENTION);
    expect(app.message).toBeUndefined();
  });
});

describe("App library search (s)", () => {
  it("searches the whole library live and shows the query in the header", () => {
    goToFolder("Physics");
    press("l", "s");
    expect(app.inline?.purpose).toBe("search");
    typeText(BERT_QUERY);
    expect(app.search).toBe(BERT_QUERY);
    expect(pane("header")).toContain("search ›");
    expect(pane("header")).toContain(BERT_QUERY);
    expect(pane("header")).toContain("1 result");
    expect(ids()).toEqual([BERT]);
    expect(pane("papers")).toContain("BERT: Pre-training");
    expect(pane("status")).toContain("SEARCH");
  });

  it("returns to the folder it started from with Esc", () => {
    goToFolder("Physics");
    press("l", "s");
    typeText(BERT_QUERY);
    press("esc");
    expect(app.inline).toBeUndefined();
    expect(app.search).toBeUndefined();
    expect(app.folder).toBe("Physics");
    expect(pane("header")).not.toContain("search ›");
    expect(ids()).toEqual([EINSTEIN]);
  });

  it("keeps the results on Enter and leaves the search with Esc", () => {
    press("s");
    typeText("einstein");
    press("enter");
    expect(app.inline).toBeUndefined();
    expect(app.search).toBe("einstein");
    expect(ids()).toEqual([EINSTEIN]);
    expect(pane("header")).toContain("search › einstein");
    press("esc");
    expect(app.search).toBeUndefined();
    expect(ids()).toHaveLength(5);
  });

  it("leaves the search with h as well", () => {
    press("s");
    typeText("einstein");
    press("enter", "h");
    expect(app.search).toBeUndefined();
    expect(pane("header")).toContain("All papers");
  });

  it("shows every paper for an empty query", () => {
    press("s");
    typeText("x");
    press("backspace");
    expect(app.search).toBe("");
    expect(pane("header")).toContain("(everything)");
    expect(pane("header")).toContain("5 results");
  });

  it("explains an empty result", () => {
    press("s");
    typeText("qqqqzzzz");
    expect(pane("papers")).toContain("Nothing found.");
    expect(pane("header")).toContain("0 results");
  });

  it("leaves the search when Enter confirms an empty query", () => {
    press("s", "enter");
    expect(app.search).toBeUndefined();
    expect(ids()).toHaveLength(5);
  });

  it("finds a paper by the text of its highlights", async () => {
    await writeSidecar(ATTENTION, [highlight(ATTENTION, 2, "Compare with the RNN baseline")]);
    await ctx.store.reload();
    await eventually(async () => {
      ctx.store.setAnnotationText(await ctx.sidecars.annotationIndex(ctx.store.snapshot.papers.keys()));
      return ctx.store.search("baseline", { key: "title", reverse: false }).length === 1;
    }, "the highlight to be indexed");
    press("s");
    typeText("baseline");
    expect(ids()).toEqual([ATTENTION]);
  });

  it("applies the filter inside the results", () => {
    press("s");
    typeText("transformers");
    press("enter");
    expect(ids().length).toBeGreaterThanOrEqual(2);
    press("f");
    typeText(BERT_QUERY);
    expect(ids()).toEqual([BERT]);
  });
});

describe("App preview tabs", () => {
  it("cycles the tabs with Tab and Shift-Tab", () => {
    expect(app.previewTab).toBe(0);
    press("tab");
    expect(app.previewTab).toBe(1);
    press("tab", "tab");
    expect(app.previewTab).toBe(3);
    press("tab");
    expect(app.previewTab).toBe(0);
    press("S-tab");
    expect(app.previewTab).toBe(3);
    press("S-tab");
    expect(app.previewTab).toBe(2);
  });

  it("shows the abstract on the second tab", () => {
    press("tab");
    expect(pane("preview")).toContain("The dominant sequence transduction");
    expect(pane("preview")).not.toContain("Status ○ unread");
  });

  it("says when a paper has no abstract", () => {
    press("j", "tab");
    expect(hoveredId()).toBe(BERT);
    expect(pane("preview")).toContain("No abstract stored for this paper.");
  });

  it("shows the BibTeX on the fourth tab", () => {
    press("S-tab");
    expect(pane("preview")).toContain("@article{vaswani2017attention,");
    expect(pane("preview")).toContain("Attention Is All You Need");
    expect(pane("preview")).toContain("year = {2017}");
  });

  it("highlights the active tab in the tab bar", () => {
    expect(pane("preview")).toContain("Info  Abstract  Notes  BibTeX");
    const rect = computeLayout(120, 30, "papers").preview!;
    const screen = app.frame().screen;
    const row = screen.rowText(rect.y);
    const info = row.indexOf("Info");
    const abstract = row.indexOf("Abstract");
    expect(screen.styleAt(info, rect.y)).toEqual(theme.tabActive);
    expect(screen.styleAt(abstract, rect.y)).toEqual(theme.tabInactive);
  });

  it("shows highlights from the sidecar on the Notes tab, with the PDF's line breaks collapsed", async () => {
    await writeSidecar(ATTENTION, [
      highlight(ATTENTION, 1, "The dominant sequence\ntransduction mod-\nels are based on complex recurrent"),
      highlight(ATTENTION, 2, "Compare with the RNN baseline", { type: "note" }),
    ]);
    press("tab", "tab");
    await eventually(() => pane("preview").includes("p. 1"), "the sidecar to load");
    const preview = pane("preview");
    expect(preview).toContain("▌ The dominant sequence transduction");
    expect(preview).toContain("models are based on complex recurrent");
    expect(preview).not.toContain("mod-");
    expect(preview).toContain("p. 2");
    expect(preview).toContain("Compare with the RNN baseline");
    expect(preview).toContain("Notes 2");
  });

  it("says so on the Notes tab when a paper has no highlights", () => {
    press("tab", "tab");
    expect(pane("preview")).toContain("No highlights or notes yet.");
  });

  it("counts the highlights on the Info tab once the sidecar is loaded", async () => {
    await writeSidecar(ATTENTION, [highlight(ATTENTION, 1, "one"), highlight(ATTENTION, 2, "two")]);
    await ctx.store.reload();
    await eventually(() => pane("preview").includes("2 highlights"), "the sidecar to load");
    expect(pane("preview")).toContain("Notes  2 highlights — Tab to read");
  });
});

describe("App selection", () => {
  it("selects the hovered paper with space and moves to the next one", () => {
    press("space");
    expect([...app.selection]).toEqual([ATTENTION]);
    expect(hoveredId()).toBe(BERT);
    expect(pane("status")).toContain("1 selected");
    expect(pane("papers").split("\n")[0]!.startsWith("▌")).toBe(true);
    press("space");
    expect([...app.selection]).toEqual([ATTENTION, BERT]);
    expect(pane("status")).toContain("2 selected");
  });

  it("unselects a selected paper when space is pressed on it again", () => {
    press("space", "k", "space");
    expect(app.selection.size).toBe(0);
    expect(pane("status")).not.toContain("selected");
  });

  it("selects a range in visual mode and leaves it with Esc", () => {
    press("v");
    expect(pane("status")).toContain("VISUAL");
    press("j", "j");
    expect([...app.selection].sort()).toEqual([ATTENTION, BERT, LECUN].sort());
    press("k");
    expect([...app.selection].sort()).toEqual([ATTENTION, BERT].sort());
    press("esc");
    expect(pane("status")).not.toContain("VISUAL");
    expect(app.selection.size).toBe(2);
    press("esc");
    expect(app.selection.size).toBe(0);
  });

  it("leaves visual mode with v again, keeping the selection", () => {
    press("v", "j", "v");
    expect(pane("status")).not.toContain("VISUAL");
    expect(app.selection.size).toBe(2);
  });

  it("selects everything with C-a and clears it with Esc", () => {
    press("C-a");
    expect(app.selection.size).toBe(5);
    expect(pane("status")).toContain("5 selected");
    press("esc");
    expect(app.selection.size).toBe(0);
  });

  it("only selects while the papers pane has focus", () => {
    press("h", "space", "C-a", "v");
    expect(app.selection.size).toBe(0);
  });

  it("drops papers that disappear from the library from the selection", async () => {
    press("G", "space");
    expect([...app.selection]).toEqual([ZEBRA]);
    await fs.rm(paperDir("", ZEBRA), { recursive: true });
    await ctx.store.reload();
    expect(app.selection.size).toBe(0);
  });
});

describe("App unknown and interrupted key sequences", () => {
  it("ignores an unbound key", () => {
    const before = screenText();
    press("w");
    expect(app.pending).toEqual([]);
    expect(screenText()).toBe(before);
    expect(app.overlay).toBeUndefined();
  });

  it("ignores an unbound continuation of a prefix", () => {
    const before = screenText();
    press("g", "w");
    expect(app.pending).toEqual([]);
    expect(screenText()).toBe(before);
    press("m", "q");
    expect(app.pending).toEqual([]);
  });

  it("treats the key that broke a sequence as a fresh key", () => {
    press("g", "j");
    expect(hoveredId()).toBe(BERT);
  });

  it("cancels a pending prefix with Esc without clearing the selection", () => {
    press("space");
    press("m", "esc");
    expect(app.pending).toEqual([]);
    expect(app.selection.size).toBe(1);
  });

  it("ignores unbound special keys and mouse buttons other than the left one", () => {
    const before = screenText();
    press("f12", "insert", "delete", "C-x", "M-x");
    click(30, 3, 2);
    expect(screenText()).toBe(before);
  });
});

describe("App marking status (m)", () => {
  it("marks the selected papers done on disk and keeps their other fields", async () => {
    press("space", "space");
    expect(app.selection.size).toBe(2);
    press("m", "d");
    await idle();
    for (const id of [ATTENTION, BERT]) {
      expect((await readMeta(folderOf(id), id))["status"]).toBe("done");
    }
    const attention = await readMeta("ML/Transformers", ATTENTION);
    expect(attention).toMatchObject({
      title: "Attention Is All You Need",
      authors: ["Ashish Vaswani", "Noam Shazeer"],
      year: 2017,
      citekey: ATTENTION,
      status: "done",
      tags: ["nlp", "transformers"],
      doi: "10.5555/3295222.3295349",
    });
    expect(app.selection.size).toBe(0);
    expect(app.message?.text).toBe("2 items marked done");
    expect(pane("status")).toContain("2 items marked done");
  });

  it("does not touch papers that were not selected", async () => {
    const before = await fs.readFile(path.join(paperDir("Physics", EINSTEIN), "metadata.yaml"), "utf8");
    press("space", "m", "d");
    await idle();
    expect(await fs.readFile(path.join(paperDir("Physics", EINSTEIN), "metadata.yaml"), "utf8")).toBe(before);
    expect((await readMeta("ML/Transformers", BERT))["status"]).toBe("reading");
  });

  it("marks the hovered paper when nothing is selected", async () => {
    press("m", "r");
    await idle();
    expect((await readMeta("ML/Transformers", ATTENTION))["status"]).toBe("reading");
    expect(app.message?.text).toBe("1 item marked reading");
  });

  it("marks a paper unread", async () => {
    press("j", "m", "u");
    await idle();
    expect((await readMeta("ML/Transformers", BERT))["status"]).toBe("unread");
  });

  it("shows the new status in the list", async () => {
    press("m", "d");
    await idle();
    expect(pane("papers").split("\n")[0]).toContain("●");
    expect(pane("preview")).toContain("Status ● done");
  });

  it("writes the BibTeX file next to the metadata, like VS Code", async () => {
    press("m", "d");
    await idle();
    expect(await exists(path.join(paperDir("ML/Transformers", ATTENTION), "bib.bib"))).toBe(true);
  });

  it("asks to pick papers first when the folders pane has focus and nothing is selected", () => {
    press("h", "m", "d");
    expect(app.message?.text).toBe("Move to the papers (l) or select some first");
    expect(app.message?.level).toBe("warn");
    expect(app.tasks.size).toBe(0);
  });
});

describe("App tags (t)", () => {
  it("opens a prompt with the paper's tags and writes the edited list on Enter", async () => {
    press("t");
    expect(app.overlay?.kind).toBe("prompt");
    expect(screenText()).toContain("Tags of Attention Is All You Need");
    expect(screenText()).toContain("nlp, transformers,");
    typeText("attention");
    press("enter");
    expect(app.overlay).toBeUndefined();
    await idle();
    expect((await readMeta("ML/Transformers", ATTENTION))["tags"]).toEqual(["nlp", "transformers", "attention"]);
    expect(app.message?.text).toBe("Tags: nlp, transformers, attention");
    expect(pane("preview")).toContain("#attention");
  });

  it("replaces the tags when the field is cleared first", async () => {
    press("t", "C-u");
    typeText("deep learning, nlp");
    press("enter");
    await idle();
    expect((await readMeta("ML/Transformers", ATTENTION))["tags"]).toEqual(["deep learning", "nlp"]);
  });

  it("removes all tags when the field is left empty", async () => {
    press("t", "C-u", "enter");
    await idle();
    const tags = (await readMeta("ML/Transformers", ATTENTION))["tags"];
    expect(tags === undefined || (Array.isArray(tags) && tags.length === 0)).toBe(true);
    expect(app.message?.text).toBe("Tags cleared");
  });

  it("keeps the other metadata when only the tags change", async () => {
    press("t");
    typeText("x");
    press("enter");
    await idle();
    expect(await readMeta("ML/Transformers", ATTENTION)).toMatchObject({
      title: "Attention Is All You Need", status: "unread", year: 2017, doi: "10.5555/3295222.3295349",
    });
  });

  it("removes duplicate tags, ignoring case", async () => {
    press("t", "C-u");
    typeText("NLP, nlp, Nlp, other");
    press("enter");
    await idle();
    expect((await readMeta("ML/Transformers", ATTENTION))["tags"]).toEqual(["NLP", "other"]);
  });

  it("cancels with Esc and leaves the file alone", async () => {
    const before = await fs.readFile(path.join(paperDir("ML/Transformers", ATTENTION), "metadata.yaml"), "utf8");
    press("t");
    typeText("zzz");
    press("esc");
    expect(app.overlay).toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await fs.readFile(path.join(paperDir("ML/Transformers", ATTENTION), "metadata.yaml"), "utf8")).toBe(before);
  });

  it("sends typed keys to the field, not to the main keymap", () => {
    press("t");
    press("j", "G", "d");
    expect(hoveredId()).toBe(ATTENTION);
    expect(app.overlay?.kind).toBe("prompt");
    expect(screenText()).toContain("transformers, jGd");
  });

  it("edits with the cursor keys", async () => {
    press("t", "C-u");
    typeText("alpha, gamma");
    press("M-b", "left");
    typeText("beta ");
    press("enter");
    await idle();
    const tags = (await readMeta("ML/Transformers", ATTENTION))["tags"] as string[];
    expect(tags.join("|")).toBe("alpha|beta gamma");
  });

  it("completes an existing tag with Tab", () => {
    press("t", "C-u");
    typeText("tr");
    press("tab");
    expect(app.overlay?.kind === "prompt" && app.overlay.input.value).toBe("transformers, ");
    press("esc");
  });

  it("lists the candidates when several tags start the same way", async () => {
    press("j", "t");
    typeText("n");
    press("tab");
    expect(screenText()).toContain("nlp");
    press("esc");
    await idle();
  });

  it("edits the tags of several selected papers at once with +tag and -tag", async () => {
    press("space", "space", "t");
    expect(screenText()).toContain("Tags of 2 papers");
    typeText("foo -nlp");
    press("enter");
    await idle();
    expect((await readMeta("ML/Transformers", ATTENTION))["tags"]).toEqual(["transformers", "foo"]);
    expect((await readMeta("ML/Transformers", BERT))["tags"]).toEqual(["foo"]);
    expect(app.selection.size).toBe(0);
    expect(app.message?.text).toBe("2 items updated");
  });

  it("asks for papers first in the folders pane", () => {
    press("h", "t");
    expect(app.overlay).toBeUndefined();
    expect(app.message?.text).toBe("Move to the papers (l) or select some first");
  });
});

describe("App cut and paste (x, p)", () => {
  it("moves a paper folder on disk to the folder hovered when p is pressed", async () => {
    press("G", "x");
    expect(app.cut).toEqual([`p:${ZEBRA}`]);
    expect(app.message?.text).toBe("1 paper cut — go to a folder and press p");
    expect(pane("status")).toContain("1 cut");
    press("h", "j", "j");
    expect(app.folder).toBe("Empty");
    press("p");
    await idle();
    expect(await exists(path.join(paperDir("Empty", ZEBRA), "metadata.yaml"))).toBe(true);
    expect(await exists(paperDir("", ZEBRA))).toBe(false);
    expect(app.cut).toBeUndefined();
    expect(app.message?.text).toBe("1 item moved to Empty");
  });

  it("keeps the paper's files together when it moves", async () => {
    press("G", "x", "h", "j", "j", "p");
    await idle();
    expect((await fs.readdir(paperDir("Empty", ZEBRA))).sort()).toEqual(["metadata.yaml", "paper.pdf"]);
  });

  it("removes the Unfiled row once the last unfiled paper is gone", async () => {
    press("G", "x", "h", "j", "j", "p");
    await idle();
    expect(app.folderRows().map((row) => row.key)).not.toContain("");
    expect(pane("folders")).not.toContain("Unfiled");
    expect(pane("folders")).toContain("Empty");
  });

  it("moves several selected papers", async () => {
    press("space", "space", "x");
    expect(app.cut).toEqual([`p:${ATTENTION}`, `p:${BERT}`]);
    expect(app.selection.size).toBe(0);
    goToFolder("Physics");
    press("p");
    await idle();
    expect(await exists(paperDir("Physics", ATTENTION))).toBe(true);
    expect(await exists(paperDir("Physics", BERT))).toBe(true);
    expect(app.message?.text).toBe("2 items moved to Physics");
    expect(ids().sort()).toEqual([ATTENTION, BERT, EINSTEIN].sort());
  });

  it("keeps the sidecar and the paper's contents when moving", async () => {
    await writeSidecar(ZEBRA, [highlight(ZEBRA, 1, "kept")]);
    press("G", "x", "h", "j", "j", "p");
    await idle();
    expect(await exists(path.join(root, ".research", "papers", ZEBRA, "data.json"))).toBe(true);
    expect(await readMeta("Empty", ZEBRA)).toMatchObject({ title: "Zebra Study of Stripes", note: "Check the stripes" });
  });

  it("marks the cut paper in the list", () => {
    press("G", "x");
    const rows = pane("papers").split("\n");
    expect(rows[4]!.startsWith("▌")).toBe(true);
  });

  it("clears the cut with Esc", () => {
    press("x");
    expect(app.cut).toBeDefined();
    press("esc");
    expect(app.cut).toBeUndefined();
    expect(app.message?.text).toBe("Cut cleared");
  });

  it("refuses to paste into All papers and keeps the cut", () => {
    press("x", "p");
    expect(app.message?.text).toContain("Choose a folder to paste into");
    expect(app.message?.level).toBe("warn");
    expect(app.cut).toEqual([`p:${ATTENTION}`]);
  });

  it("explains that there is nothing to paste", () => {
    press("p");
    expect(app.message?.text).toBe("Nothing to paste — cut papers or a folder with x first");
  });

  it("moves a whole folder when a folder is cut", async () => {
    goToFolder("Empty");
    press("x");
    expect(app.cut).toEqual(["c:Empty"]);
    expect(app.message?.text).toContain('Folder "Empty" cut');
    press("j", "j", "j");
    expect(app.folder).toBe("Physics");
    press("p");
    await idle();
    expect(await exists(folderDir("Physics/Empty"))).toBe(true);
    expect(await exists(folderDir("Empty"))).toBe(false);
    expect(app.folder).toBe("Physics/Empty");
  });

  it("refuses to move a folder into itself", async () => {
    goToFolder("ML");
    press("x", "j");
    expect(app.folder).toBe("ML/Transformers");
    press("p");
    await idle();
    expect(app.message?.level).toBe("error");
    expect(app.message?.text).toContain("cannot be moved into itself");
    expect(await exists(folderDir("ML/Transformers"))).toBe(true);
  });

  it("does not cut the Unfiled pseudo folder", () => {
    goToFolder("");
    press("x");
    expect(app.cut).toBeUndefined();
    expect(app.message?.text).toBe("The library root cannot be moved");
  });

  it("drops a cut paper that disappears from the library", async () => {
    press("x");
    await fs.rm(paperDir("ML/Transformers", ATTENTION), { recursive: true });
    await ctx.store.reload();
    expect(app.cut).toBeUndefined();
  });
});

describe("App move to folder (M)", () => {
  it("opens a folder picker and moves the selected papers", async () => {
    press("G", "M");
    expect(app.overlay?.kind).toBe("picker");
    expect(screenText()).toContain("Move 1 paper to");
    expect(screenText()).not.toContain("All papers (");
    typeText("empty");
    press("enter");
    await idle();
    expect(await exists(path.join(paperDir("Empty", ZEBRA), "metadata.yaml"))).toBe(true);
    expect(await exists(paperDir("", ZEBRA))).toBe(false);
  });

  it("moves papers to the library root", async () => {
    press("M");
    typeText("unfiled");
    press("enter");
    await idle();
    expect(await exists(path.join(paperDir("", ATTENTION), "metadata.yaml"))).toBe(true);
  });

  it("moves a hovered folder", async () => {
    goToFolder("Empty");
    press("M");
    expect(screenText()).toContain('Move folder "Empty" to');
    typeText("physics");
    press("enter");
    await idle();
    expect(await exists(folderDir("Physics/Empty"))).toBe(true);
  });

  it("does not offer a folder as its own destination", () => {
    goToFolder("ML");
    press("M");
    typeText("transformers");
    expect(screenText()).toContain("No match");
  });
});

describe("App trash (d) asks for confirmation", () => {
  it("shows the confirmation for the hovered paper and cancels with n", async () => {
    press("d");
    expect(app.overlay?.kind).toBe("confirm");
    const text = screenText();
    expect(text).toContain("Move to trash");
    expect(text).toContain('Move "Attention Is All You Need" to the trash?');
    expect(text).toContain("The next sync removes them from Drive and from VS Code too.");
    expect(text).toContain("y confirm");
    press("n");
    expect(app.overlay).toBeUndefined();
    expect(await exists(path.join(paperDir("ML/Transformers", ATTENTION), "metadata.yaml"))).toBe(true);
    expect(ids()).toHaveLength(5);
    expect(mocked.moveToTrash).not.toHaveBeenCalled();
  });

  it("cancels with Esc too", () => {
    press("d", "esc");
    expect(app.overlay).toBeUndefined();
    expect(ids()).toHaveLength(5);
  });

  it("names the number of papers when several are selected", () => {
    press("space", "space", "d");
    expect(screenText()).toContain("Move 2 papers to the trash?");
    press("n");
    expect(app.selection.size).toBe(2);
    expect(mocked.moveToTrash).not.toHaveBeenCalled();
  });

  it("asks about the whole folder when a folder is hovered", () => {
    goToFolder("Physics");
    press("d");
    expect(screenText()).toContain('Move folder "Physics" and its 1 paper to the trash?');
    press("n");
    expect(app.overlay).toBeUndefined();
    expect(app.folder).toBe("Physics");
    goToFolder("ML");
    press("d");
    expect(screenText()).toContain('Move folder "ML" and its 3 papers to the trash?');
    press("n");
    expect(mocked.moveToTrash).not.toHaveBeenCalled();
  });

  it("ignores other keys while the confirmation is open", () => {
    press("d", "j", "G", "x", "q");
    expect(app.overlay).toBeUndefined();
    press("d", "j", "o");
    expect(app.overlay?.kind).toBe("confirm");
    press("esc");
    expect(mocked.openExternal).not.toHaveBeenCalled();
  });

  it("reports when the platform cannot trash", () => {
    mocked.trashSupported.mockReturnValue(false);
    press("d");
    expect(app.overlay).toBeUndefined();
    expect(app.message?.text).toBe("Moving to the trash is not supported on this system");
    expect(app.message?.level).toBe("error");
  });

  it("does nothing in the folders pane at All papers", () => {
    press("h", "d");
    expect(app.overlay).toBeUndefined();
    expect(app.message?.text).toBe("Move to the papers (l) or select some first");
  });
});

describe("App new folder (a)", () => {
  it("creates a folder on disk from the folders pane", async () => {
    press("h", "a");
    expect(app.overlay?.kind).toBe("prompt");
    expect(screenText()).toContain("New folder in the library root");
    typeText("Chemistry");
    press("enter");
    await idle();
    expect((await fs.stat(folderDir("Chemistry"))).isDirectory()).toBe(true);
    expect(app.folder).toBe("Chemistry");
    expect(app.focus).toBe("folders");
    expect(app.message?.text).toBe('Folder "Chemistry" created');
    expect(pane("folders")).toContain("Chemistry");
  });

  it("creates the folder inside the hovered folder", async () => {
    goToFolder("ML");
    press("a");
    expect(screenText()).toContain("New folder in ML");
    typeText("Deep Learning");
    press("enter");
    await idle();
    expect((await fs.stat(folderDir("ML/Deep Learning"))).isDirectory()).toBe(true);
    expect(app.folder).toBe("ML/Deep Learning");
  });

  it("creates a folder from the papers pane when the name ends with a slash", async () => {
    press("a");
    expect(screenText()).toContain("Add a paper to the library root");
    expect(screenText()).toContain("PDF or folder path");
    typeText("Chemistry/");
    press("enter");
    await idle();
    expect((await fs.stat(folderDir("Chemistry"))).isDirectory()).toBe(true);
  });

  it("names the target folder in the papers pane prompt", () => {
    goToFolder("Physics");
    press("l", "a");
    expect(screenText()).toContain("Add a paper to Physics");
  });

  it("rejects a name with slashes", async () => {
    press("h", "a");
    typeText("bad/name");
    press("enter");
    await idle();
    expect(app.message?.text).toBe("Use a name without slashes.");
    expect(app.message?.level).toBe("error");
    expect(await exists(folderDir("bad"))).toBe(false);
  });

  it("rejects a hidden folder name", async () => {
    press("h", "a");
    typeText(".hidden");
    press("enter");
    await idle();
    expect(app.message?.text).toBe("A collection name cannot start with a dot.");
    expect(await exists(folderDir(".hidden"))).toBe(false);
  });

  it("rejects a name that already exists", async () => {
    press("h", "a");
    typeText("ML");
    press("enter");
    await idle();
    expect(app.message?.text).toBe('"ML" already exists');
    expect(app.message?.level).toBe("error");
  });

  it("does nothing for an empty name", async () => {
    press("h", "a", "enter");
    expect(app.overlay).toBeUndefined();
    expect(app.tasks.size).toBe(0);
    expect(app.message).toBeUndefined();
    expect((await fs.readdir(papersDir())).sort()).toEqual(["Empty", "ML", "Physics", ZEBRA]);
  });

  it("closes the prompt with Esc without creating anything", async () => {
    press("h", "a");
    typeText("Nope");
    press("esc");
    expect(app.overlay).toBeUndefined();
    expect(await exists(folderDir("Nope"))).toBe(false);
  });

  it("accepts a pasted name", async () => {
    press("h", "a");
    app.handle({ type: "paste", text: "Pasted Folder\n" });
    press("enter");
    await idle();
    expect(await exists(folderDir("Pasted Folder"))).toBe(true);
  });

  it("reports an input that is neither a file, a URL nor an identifier", async () => {
    press("a");
    typeText("not a paper");
    press("enter");
    await idle();
    expect(app.message?.level).toBe("warn");
    expect(app.message?.text).toContain("1 failed");
    expect(ids()).toHaveLength(5);
  });
});

describe("App rename (r)", () => {
  it("renames the hovered folder on disk", async () => {
    goToFolder("Physics");
    press("r");
    expect(screenText()).toContain("Rename folder");
    expect(app.overlay?.kind === "prompt" && app.overlay.input.value).toBe("Physics");
    press("C-u");
    typeText("Physik");
    press("enter");
    await idle();
    expect(await exists(folderDir("Physik"))).toBe(true);
    expect(await exists(folderDir("Physics"))).toBe(false);
    expect(app.folder).toBe("Physik");
    expect(app.message?.text).toBe('Renamed to "Physik"');
    expect(await exists(paperDir("Physik", EINSTEIN))).toBe(true);
  });

  it("renames a subfolder within its parent", async () => {
    goToFolder("ML/Transformers");
    press("r", "C-u");
    typeText("Attention");
    press("enter");
    await idle();
    expect(await exists(paperDir("ML/Attention", ATTENTION))).toBe(true);
    expect(app.folder).toBe("ML/Attention");
  });

  it("keeps the old name when the new one already exists", async () => {
    goToFolder("Physics");
    press("r", "C-u");
    typeText("ML");
    press("enter");
    await idle();
    expect(app.message?.text).toBe('"ML" already exists there');
    expect(await exists(folderDir("Physics"))).toBe(true);
  });

  it("explains that paper titles are not renamed", () => {
    press("r");
    expect(app.overlay).toBeUndefined();
    expect(app.message?.text).toContain("Paper titles stay as resolved");
  });

  it("asks to hover a folder at All papers and Unfiled", () => {
    press("h", "r");
    expect(app.message?.text).toBe("Hover a folder to rename it");
    goToFolder("");
    press("r");
    expect(app.message?.text).toBe("Hover a folder to rename it");
  });
});

describe("App help (?)", () => {
  it("shows the key help and Esc closes it", () => {
    press("?");
    expect(app.overlay?.kind).toBe("help");
    expect(screenText()).toContain("LabShelf keys");
    expect(screenText()).toContain("Navigate");
    expect(screenText()).toContain("Move down");
    press("esc");
    expect(app.overlay).toBeUndefined();
  });

  it("closes with ?, q and Enter as well", () => {
    for (const key of ["?", "q", "enter"]) {
      press("?");
      expect(app.overlay?.kind).toBe("help");
      press(key);
      expect(app.overlay).toBeUndefined();
    }
  });

  it("opens with F1", () => {
    press("f1");
    expect(app.overlay?.kind).toBe("help");
  });

  it("scrolls with j and k and pages with space", () => {
    const target = helpRows().findIndex((row) => row.keys === "m d");
    const pages = Math.floor(target / 10);
    press("?");
    expect(screenText()).not.toContain("Mark done");
    for (let i = 0; i < target; i++) { press("j"); }
    expect(screenText()).toContain("Mark done");
    for (let i = 0; i < target; i++) { press("k"); }
    expect(screenText()).not.toContain("Mark done");
    for (let i = 0; i < pages; i++) { press("space"); }
    expect(screenText()).toContain("Mark done");
    for (let i = 0; i < pages; i++) { press("C-u"); }
    expect(screenText()).not.toContain("Mark done");
  });

  it("does not move the list while open", () => {
    press("?", "j", "j", "esc");
    expect(hoveredId()).toBe(ATTENTION);
  });

  it("opens from the command line too", () => {
    press(":");
    typeText("help");
    press("enter");
    expect(app.overlay?.kind).toBe("help");
  });
});

describe("App command line (:)", () => {
  function command(line: string): void {
    press(":");
    typeText(line);
    press("enter");
  }

  it("opens a command prompt with a hint", () => {
    press(":");
    expect(app.overlay?.kind).toBe("prompt");
    expect(screenText()).toContain("Command");
    expect(screenText()).toContain("sync · login · logout");
    press("esc");
    expect(app.overlay).toBeUndefined();
  });

  it("navigates with cd", () => {
    command("cd ML/Transformers");
    expect(app.folder).toBe("ML/Transformers");
    expect(app.focus).toBe("papers");
    expect(ids()).toEqual([ATTENTION, BERT]);
  });

  it("accepts a papers/ prefix and surrounding slashes", () => {
    command("cd papers/Physics");
    expect(app.folder).toBe("Physics");
    command("cd /ML/");
    expect(app.folder).toBe("ML");
  });

  it("goes to All papers with a bare cd", () => {
    command("cd Physics");
    command("cd");
    expect(app.folder).toBe(ALL);
  });

  it("warns about a folder that does not exist", () => {
    command("cd Nope");
    expect(app.folder).toBe(ALL);
    expect(app.message?.text).toBe('No folder "Nope"');
    expect(app.message?.level).toBe("warn");
  });

  it("sorts with sort <key> [desc]", () => {
    command("sort year");
    expect(app.sort).toEqual({ key: "year", reverse: false });
    expect(ids()[0]).toBe(ZEBRA);
    command("sort year desc");
    expect(app.sort).toEqual({ key: "year", reverse: true });
    expect(ids()[0]).toBe(EINSTEIN);
    expect(app.message?.text).toBe("Sorted by year, reversed");
  });

  it("rejects an unknown sort key", () => {
    command("sort bogus");
    expect(app.sort.key).toBe("title");
    expect(app.message?.text).toContain('Unknown sort key "bogus"');
  });

  it("creates a folder with mkdir", async () => {
    command("mkdir Biology");
    await idle();
    expect(await exists(folderDir("Biology"))).toBe(true);
  });

  it("explains the usage of mkdir, add and export without arguments", () => {
    command("mkdir");
    expect(app.message?.text).toBe("Usage: :mkdir <name>");
    command("add");
    expect(app.message?.text).toBe("Usage: :add <pdf | folder | url | doi | arxiv id>");
    command("export");
    expect(app.message?.text).toBe("Usage: :export <file.bib>");
  });

  it("exports BibTeX to a file", async () => {
    const file = path.join(tmp, "all.bib");
    command(`export ${file}`);
    await idle();
    const bib = await fs.readFile(file, "utf8");
    for (const spec of PAPERS) { expect(bib).toContain(`@article{${spec.id},`); }
    expect(app.message?.text).toBe(`5 BibTeX entries written to ${file}`);
  });

  it("shows where the library lives", () => {
    command("where");
    expect(app.message?.text).toContain(`Library: ${path.resolve(root)}`);
    expect(app.message?.text).toContain("terminal.log");
  });

  it("reloads the library from disk", async () => {
    await writePaper({ id: "new2021paper", folder: "", title: "A Brand New Paper", year: 2021, pdf: true });
    command("reload");
    await eventually(() => app.message?.text === "Library reloaded", "the reload");
    expect(pane("papers")).toContain("A Brand New Paper");
  });

  it("complains about an unknown command", () => {
    command("frobnicate now");
    expect(app.message?.text).toBe('Unknown command "frobnicate" — ? lists the keys');
    expect(app.message?.level).toBe("warn");
  });

  it("ignores an empty command", () => {
    command("");
    expect(app.overlay).toBeUndefined();
    expect(app.message).toBeUndefined();
  });

  it("quits with :q, leaving the terminal", async () => {
    command("q");
    await eventually(() => term.left === 1, "the terminal to be released");
  });
});

describe("App sorting (,)", () => {
  it("sorts by year, newest first, and shows it in the status bar", () => {
    press(",", "y");
    expect(app.sort).toEqual({ key: "year", reverse: false });
    expect(ids()).toEqual([ZEBRA, BERT, ATTENTION, LECUN, EINSTEIN]);
    expect(pane("status")).toContain("year↑");
    expect(app.message?.text).toBe("Sorted by year");
  });

  it("reverses with the capital letter", () => {
    press(",", "Y");
    expect(app.sort).toEqual({ key: "year", reverse: true });
    expect(ids()).toEqual([EINSTEIN, LECUN, ATTENTION, BERT, ZEBRA]);
    expect(pane("status")).toContain("year↓");
  });

  it("sorts by first author", () => {
    press(",", "a");
    expect(ids()).toEqual([BERT, EINSTEIN, LECUN, ATTENTION, ZEBRA]);
  });

  it("sorts by status with reading first", () => {
    press(",", "s");
    expect(ids()).toEqual([BERT, ATTENTION, ZEBRA, LECUN, EINSTEIN]);
  });

  it("goes back to title order", () => {
    press(",", "y", ",", "t");
    expect(ids()).toEqual([ATTENTION, BERT, LECUN, EINSTEIN, ZEBRA]);
  });

  it("keeps the same paper hovered when the order changes", () => {
    press("j");
    expect(hoveredId()).toBe(BERT);
    press(",", "y");
    expect(hoveredId()).toBe(BERT);
    expect(pane("status")).toContain("2/5");
  });
});

describe("App copying (y) and opening", () => {
  const copied = (): string[] => mocked.copyToClipboard.mock.calls.map((call) => call[0]);
  const copiedOnce = async (): Promise<string> => {
    await eventually(() => mocked.copyToClipboard.mock.calls.length === 1, "the clipboard to be written");
    return copied()[0]!;
  };

  it("copies the cite key with y k", async () => {
    press("y", "k");
    expect(await copiedOnce()).toBe(ATTENTION);
    await eventually(() => app.message?.text === `Copied ${ATTENTION}`, "the message");
  });

  it("copies the cite keys of all selected papers, separated by commas", async () => {
    press("space", "space", "y", "k");
    expect(await copiedOnce()).toBe(`${ATTENTION}, ${BERT}`);
    await eventually(() => app.message?.text === "Copied cite keys (2)", "the message");
  });

  it("copies a \\cite command with y c", async () => {
    press("space", "space", "y", "c");
    expect(await copiedOnce()).toBe(`\\cite{${ATTENTION},${BERT}}`);
  });

  it("copies the DOI as a link with y d, and warns when there is none", async () => {
    press("y", "d");
    expect(await copiedOnce()).toBe("https://doi.org/10.5555/3295222.3295349");
    mocked.copyToClipboard.mockClear();
    press("j", "y", "d");
    await eventually(() => app.message?.text === "No DOI or URL stored", "the warning");
    expect(mocked.copyToClipboard).not.toHaveBeenCalled();
  });

  it("copies the title with y t", async () => {
    press("y", "t");
    expect(await copiedOnce()).toBe("Attention Is All You Need");
  });

  it("copies the PDF path with y p", async () => {
    press("y", "p");
    expect(await copiedOnce()).toBe(path.join(paperDir("ML/Transformers", ATTENTION), "paper.pdf"));
  });

  it("copies BibTeX with y b", async () => {
    press("y", "b");
    const text = await copiedOnce();
    expect(text).toContain(`@article{${ATTENTION},`);
    expect(text).toContain("title = {Attention Is All You Need}");
  });

  it("copies the highlights as Markdown with y m", async () => {
    await writeSidecar(ATTENTION, [highlight(ATTENTION, 3, "Scaled dot-product attention")]);
    press("y", "m");
    expect(await copiedOnce()).toContain("Scaled dot-product attention");
  });

  it("says when the clipboard cannot be reached", async () => {
    mocked.copyToClipboard.mockResolvedValue("failed");
    press("y", "k");
    await eventually(() => app.message?.text === "Could not reach the clipboard", "the message");
    expect(app.message?.level).toBe("error");
  });

  it("hands the OSC 52 fallback to the terminal", async () => {
    mocked.copyToClipboard.mockImplementation(async (_text, osc52) => {
      osc52?.("\x1b]52;c;Zm9v\x07");
      return "osc52";
    });
    press("y", "k");
    await eventually(() => term.raw.includes("\x1b]52;c;Zm9v\x07"), "the escape sequence");
  });

  it("asks for papers first in the folders pane", () => {
    press("h", "y", "k");
    expect(app.message?.text).toBe("Move to the papers (l) or select some first");
    expect(mocked.copyToClipboard).not.toHaveBeenCalled();
  });

  it("opens the PDF of the hovered paper with o and with l", () => {
    press("o");
    expect(mocked.openExternal).toHaveBeenCalledTimes(1);
    expect(mocked.openExternal.mock.calls[0]![0]).toBe(path.join(paperDir("ML/Transformers", ATTENTION), "paper.pdf"));
    expect(app.message?.text).toBe("Opened Attention Is All You Need");
    press("j", "l");
    expect(mocked.openExternal).toHaveBeenCalledTimes(2);
    expect(mocked.openExternal.mock.calls[1]![0]).toBe(path.join(paperDir("ML/Transformers", BERT), "paper.pdf"));
  });

  it("opens the PDF when Enter is pressed on a paper", () => {
    press("enter");
    expect(mocked.openExternal).toHaveBeenCalledTimes(1);
  });

  it("does not open anything for a paper whose PDF is not on this device", () => {
    goToFolder("Physics");
    press("l", "l");
    expect(mocked.openExternal).not.toHaveBeenCalled();
    expect(app.message?.text).toBe(`No PDF on this device for ${EINSTEIN}`);
    expect(app.message?.level).toBe("warn");
    press("o");
    expect(mocked.openExternal).not.toHaveBeenCalled();
  });

  it("reveals the paper's folder, or the hovered folder, in the file manager", () => {
    press("O");
    expect(mocked.revealInFileManager).toHaveBeenLastCalledWith(paperDir("ML/Transformers", ATTENTION));
    goToFolder("ML");
    press("O");
    expect(mocked.revealInFileManager).toHaveBeenLastCalledWith(folderDir("ML"));
  });
});

describe("App export (B)", () => {
  it("offers a default file name and the number of entries", () => {
    press("B");
    expect(app.overlay?.kind === "prompt" && app.overlay.input.value).toBe("./library.bib");
    expect(screenText()).toContain("Export BibTeX");
    expect(screenText()).toContain("5 entries");
    press("esc");
    goToFolder("ML");
    press("B");
    expect(app.overlay?.kind === "prompt" && app.overlay.input.value).toBe("./ML.bib");
    expect(screenText()).toContain("3 entries");
  });

  it("writes the BibTeX of the selected papers to the chosen file", async () => {
    const file = path.join(tmp, "selection.bib");
    press("space", "space", "B", "C-u");
    typeText(file);
    press("enter");
    await idle();
    const bib = await fs.readFile(file, "utf8");
    expect(bib).toContain(`@article{${ATTENTION},`);
    expect(bib).toContain(`@article{${BERT},`);
    expect(bib).not.toContain(`@article{${ZEBRA},`);
    expect(app.message?.text).toBe(`2 BibTeX entries written to ${file}`);
  });

  it("exports the papers of the folder, subfolders included", async () => {
    const file = path.join(tmp, "ml.bib");
    goToFolder("ML");
    press("B", "C-u");
    typeText(file);
    press("enter");
    await idle();
    const bib = await fs.readFile(file, "utf8");
    expect(bib).toContain(`@article{${LECUN},`);
    expect(bib).toContain(`@article{${ATTENTION},`);
    expect(bib).not.toContain(`@article{${EINSTEIN},`);
  });

  it("exports only the filtered papers", async () => {
    const file = path.join(tmp, "filtered.bib");
    press("f");
    typeText("tag:nlp");
    press("enter", "B", "C-u");
    typeText(file);
    press("enter");
    await idle();
    const bib = await fs.readFile(file, "utf8");
    expect(bib).toContain(`@article{${ATTENTION},`);
    expect(bib).not.toContain(`@article{${BERT},`);
  });
});

describe("App editing notes (e)", () => {
  it("opens $EDITOR on the current note and saves what the user wrote", async () => {
    let seen = "";
    mocked.runEditor.mockImplementation((file: string) => {
      seen = readFileSync(file, "utf8");
      writeFileSync(file, "Revised note\nwith two lines\n");
      return true;
    });
    press("G", "e");
    await eventually(async () => (await readMeta("", ZEBRA))["note"] === "Revised note\nwith two lines", "the note to be saved");
    expect(seen).toBe("Check the stripes");
    await eventually(() => app.message?.text === "Note saved", "the message");
  });

  it("does not rewrite the paper when the note is unchanged", async () => {
    const file = path.join(paperDir("", ZEBRA), "metadata.yaml");
    const before = await fs.readFile(file, "utf8");
    press("G", "e");
    await eventually(() => mocked.runEditor.mock.calls.length === 1, "the editor to run");
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await fs.readFile(file, "utf8")).toBe(before);
  });

  it("clears the note when the user empties it", async () => {
    mocked.runEditor.mockImplementation((file: string) => {
      writeFileSync(file, "\n");
      return true;
    });
    press("G", "e");
    await eventually(() => app.message?.text === "Note cleared", "the message");
    expect(["", undefined]).toContain((await readMeta("", ZEBRA))["note"]);
  });

  it("does not save when the editor fails", async () => {
    mocked.runEditor.mockImplementation((file: string) => {
      writeFileSync(file, "Half-written");
      return false;
    });
    press("G", "e");
    await eventually(() => app.message?.level === "warn", "the warning");
    expect(app.message?.text).toBe("The editor exited with an error; note not saved");
    expect((await readMeta("", ZEBRA))["note"]).toBe("Check the stripes");
  });
});

describe("App overlays and input routing", () => {
  it("routes pasted text to an open prompt", () => {
    press("h", "a");
    app.handle({ type: "paste", text: "line one\nline two" });
    expect(app.overlay?.kind === "prompt" && app.overlay.input.value).toBe("line one line two");
  });

  it("ignores pasted text in normal mode", () => {
    const before = screenText();
    app.handle({ type: "paste", text: "hello" });
    expect(screenText()).toBe(before);
  });

  it("ignores the mouse while an overlay is open", () => {
    press("?");
    click(30, 3);
    wheel("wheel-down", 30, 3);
    expect(app.overlay?.kind).toBe("help");
    press("esc");
    expect(hoveredId()).toBe(ATTENTION);
  });

  it("closes a prompt with C-c", () => {
    press(":", "C-c");
    expect(app.overlay).toBeUndefined();
  });

  it("shows prompt text edits made with the readline keys", () => {
    press(":");
    typeText("hello world");
    press("C-w");
    expect(app.overlay?.kind === "prompt" && app.overlay.input.value).toBe("hello ");
    press("C-a");
    typeText(">");
    expect(app.overlay?.kind === "prompt" && app.overlay.input.value).toBe(">hello ");
  });

  it("uses Tab to complete paths in the add prompt", async () => {
    await fs.mkdir(path.join(tmp, "incoming", "batch"), { recursive: true });
    press("a");
    typeText(`${tmp}/inc`);
    press("tab");
    await eventually(() => app.overlay?.kind === "prompt" && app.overlay.input.value === `${tmp}/incoming/`, "the path to complete");
  });
});

describe("App mouse", () => {
  const layout = (): ReturnType<typeof computeLayout> => computeLayout(120, 30, app.focus);

  it("hovers the paper that is clicked", () => {
    const papers = layout().papers!;
    click(papers.x + 5, papers.y + 2);
    expect(hoveredId()).toBe(LECUN);
    expect(app.focus).toBe("papers");
  });

  it("selects the folder that is clicked and focuses the folders pane", () => {
    const folders = layout().folders!;
    click(folders.x + 2, folders.y + 3);
    expect(app.focus).toBe("folders");
    expect(app.folder).toBe("ML");
    expect(pane("papers")).toContain("Gradient-Based Learning");
  });

  it("opens the PDF of the hovered paper when it is clicked again", () => {
    const papers = layout().papers!;
    click(papers.x + 5, papers.y + 1);
    expect(hoveredId()).toBe(BERT);
    expect(mocked.openExternal).not.toHaveBeenCalled();
    click(papers.x + 5, papers.y + 1);
    expect(mocked.openExternal).toHaveBeenCalledTimes(1);
  });

  it("ignores a click below the last paper", () => {
    const papers = layout().papers!;
    click(papers.x + 5, papers.y + 20);
    expect(hoveredId()).toBe(ATTENTION);
  });

  it("scrolls the list with the wheel", () => {
    const papers = layout().papers!;
    wheel("wheel-down", papers.x + 5, papers.y + 1);
    expect(hoveredId()).toBe(EINSTEIN);
    wheel("wheel-up", papers.x + 5, papers.y + 1);
    expect(hoveredId()).toBe(ATTENTION);
  });

  it("scrolls the folders with the wheel and focuses that pane", () => {
    const folders = layout().folders!;
    wheel("wheel-down", folders.x + 2, folders.y + 1);
    expect(app.focus).toBe("folders");
    expect(app.folder).toBe("ML");
    wheel("wheel-up", folders.x + 2, folders.y + 1);
    expect(app.folder).toBe(ALL);
  });

  it("scrolls the preview with the wheel over it", () => {
    const preview = layout().preview!;
    wheel("wheel-down", preview.x + 5, preview.y + 3);
    expect(app.previewScroll).toBe(3);
    wheel("wheel-up", preview.x + 5, preview.y + 3);
    expect(app.previewScroll).toBe(0);
    expect(hoveredId()).toBe(ATTENTION);
  });
});

describe("App reacting to changes made elsewhere", () => {
  it("shows a paper added on disk after the library reloads, and draws a new frame by itself", async () => {
    const frames = term.frames.length;
    await writePaper({ id: "new2021paper", folder: "Physics", title: "A Brand New Paper", year: 2021, pdf: true });
    await ctx.store.reload();
    await eventually(() => term.frames.length > frames, "a redraw");
    expect(app.folderRows().find((row) => row.key === "Physics")?.count).toBe(2);
    expect(pane("papers")).toContain("A Brand New Paper");
  });

  it("reloads with R", async () => {
    await writePaper({ id: "new2021paper", folder: "", title: "A Brand New Paper", year: 2021, pdf: true });
    press("R");
    await eventually(() => app.message?.text === "Library reloaded", "the reload");
    expect(pane("papers")).toContain("A Brand New Paper");
    expect(pane("folders")).toContain("Unfiled");
  });

  it("follows the hovered paper when the list changes under it", async () => {
    press("j");
    expect(hoveredId()).toBe(BERT);
    await writePaper({ id: "aaa2000first", folder: "", title: "AAA Sorts First", year: 2000, pdf: true });
    await ctx.store.reload();
    expect(hoveredId()).toBe(BERT);
    expect(ids()[0]).toBe("aaa2000first");
    expect(pane("status")).toContain("3/6");
  });

  it("falls back to the nearest existing folder when the current one is removed", async () => {
    goToFolder("ML/Transformers");
    await fs.rm(folderDir("ML/Transformers"), { recursive: true });
    await ctx.store.reload();
    expect(app.folder).toBe("ML");
    await fs.rm(folderDir("ML"), { recursive: true });
    await ctx.store.reload();
    expect(app.folder).toBe(ALL);
  });

  it("leaves the Unfiled row when its last paper is removed", async () => {
    goToFolder("");
    await fs.rm(paperDir("", ZEBRA), { recursive: true });
    await ctx.store.reload();
    expect(app.folder).toBe(ALL);
  });

  it("shows an edit made by another app to a paper's metadata", async () => {
    await fs.writeFile(
      path.join(paperDir("ML/Transformers", ATTENTION), "metadata.yaml"),
      yamlOf({ ...PAPERS[0]!, status: "done", tags: ["from-vscode"] }),
    );
    await ctx.store.reload();
    expect(pane("preview")).toContain("Status ● done");
    expect(pane("preview")).toContain("#from-vscode");
  });

  it("keeps a tag edit that VS Code made after the last scan when writing the status", async () => {
    await fs.writeFile(
      path.join(paperDir("ML/Transformers", ATTENTION), "metadata.yaml"),
      yamlOf({ ...PAPERS[0]!, tags: ["edited-elsewhere"] }),
    );
    press("m", "d");
    await idle();
    expect(await readMeta("ML/Transformers", ATTENTION)).toMatchObject({ status: "done", tags: ["edited-elsewhere"] });
  });
});

describe("syncSegment", () => {
  const now = Date.parse("2026-10-08T12:00:00.000Z");
  const run = (app: string, minutesAgo: number): NonNullable<Parameters<typeof syncSegment>[0]["lastRun"]> => ({
    providerId: "google-drive", app, host: "h", startedAt: "", finishedAt: new Date(now - minutesAgo * 60_000).toISOString(),
    uploaded: 0, downloaded: 0, deletedLocal: 0, deletedRemote: 0, conflicts: [],
  });

  it("says Drive is not set up", () => {
    expect(syncSegment({ state: "unconfigured" }, now)).toEqual({ text: " Drive: not set up ", style: theme.sync.off });
  });

  it("says the user is signed out", () => {
    expect(syncSegment({ state: "disconnected" }, now)).toEqual({ text: " Drive: signed out ", style: theme.sync.off });
  });

  it("shows a sync in progress", () => {
    expect(syncSegment({ state: "syncing" }, now)).toEqual({ text: " syncing… ", style: theme.sync.busy });
  });

  it("names the app whose sync is being waited for", () => {
    const holder = (app: string) => ({ app, pid: 1, host: "h", token: "t", acquiredAt: "", heartbeatAt: "" });
    expect(syncSegment({ state: "waiting", holder: holder("vscode") }, now).text).toBe(" VS Code syncing ");
    expect(syncSegment({ state: "waiting", holder: holder("terminal") }, now).text).toBe(" Another terminal session syncing ");
    expect(syncSegment({ state: "waiting", holder: holder("browser") }, now).text).toBe(" Another app syncing ");
    expect(syncSegment({ state: "waiting" }, now)).toEqual({ text: " Another app syncing ", style: theme.sync.busy });
  });

  it("shows a failed sync", () => {
    expect(syncSegment({ state: "error", lastError: "boom" }, now)).toEqual({ text: " sync failed ", style: theme.sync.error });
  });

  it("says nothing was synced yet", () => {
    expect(syncSegment({ state: "idle" }, now)).toEqual({ text: " Drive: not synced yet ", style: theme.sync.off });
  });

  it("shows when the last sync of this terminal finished", () => {
    expect(syncSegment({ state: "idle", lastRun: run("terminal", 5) }, now)).toEqual({ text: " synced 5 min ago ", style: theme.sync.ok });
  });

  it("names the other app that did the last sync", () => {
    expect(syncSegment({ state: "idle", lastRun: run("vscode", 120) }, now).text).toBe(" synced 2 h ago (VS Code) ");
    expect(syncSegment({ state: "idle", lastRun: run("browser", 0) }, now).text).toBe(" synced just now (browser) ");
  });
});

describe("completePath", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "labshelf-complete-"));
    for (const folder of ["alpha", "alps", "gamma", ".hidden"]) { await fs.mkdir(path.join(dir, folder)); }
    for (const file of ["beta.pdf", "Upper.PDF", "notes.txt", ".secret.pdf"]) { await fs.writeFile(path.join(dir, file), ""); }
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("completes the common prefix and lists the candidates when several match", async () => {
    expect(await completePath(`${dir}/al`)).toEqual({ completed: `${dir}/alp`, candidates: ["alpha/", "alps/"] });
  });

  it("completes a single folder with a trailing slash", async () => {
    expect(await completePath(`${dir}/gam`)).toEqual({ completed: `${dir}/gamma/`, candidates: [] });
  });

  it("completes a single PDF without a slash", async () => {
    expect(await completePath(`${dir}/be`)).toEqual({ completed: `${dir}/beta.pdf`, candidates: [] });
  });

  it("recognizes PDFs by extension regardless of case", async () => {
    expect(await completePath(`${dir}/Up`)).toEqual({ completed: `${dir}/Upper.PDF`, candidates: [] });
  });

  it("lists folders and PDFs only, without hidden entries, when the path ends with a slash", async () => {
    const result = await completePath(`${dir}/`);
    expect(result.candidates).toEqual(["alpha/", "alps/", "beta.pdf", "gamma/", "Upper.PDF"]);
    expect(result.completed).toBe(`${dir}/`);
  });

  it("shows hidden entries once the prefix starts with a dot", async () => {
    const result = await completePath(`${dir}/.`);
    expect(result.candidates).toEqual([".hidden/", ".secret.pdf"]);
    expect(result.completed).toBe(`${dir}/.`);
  });

  it("leaves the text alone when nothing matches", async () => {
    expect(await completePath(`${dir}/zzz`)).toEqual({ completed: `${dir}/zzz`, candidates: [] });
    expect(await completePath(`${dir}/not`)).toEqual({ completed: `${dir}/not`, candidates: [] });
  });

  it("leaves the text alone when the folder does not exist", async () => {
    expect(await completePath(`${dir}/missing/x`)).toEqual({ completed: `${dir}/missing/x`, candidates: [] });
  });

  it("completes inside a subfolder", async () => {
    await fs.mkdir(path.join(dir, "gamma", "delta"));
    expect(await completePath(`${dir}/gamma/de`)).toEqual({ completed: `${dir}/gamma/delta/`, candidates: [] });
  });

  it("expands ~ to the home folder but keeps it as typed", async () => {
    const homedir = jest.spyOn(osModule, "homedir").mockReturnValue(dir);
    try {
      expect(await completePath("~/al")).toEqual({ completed: "~/alp", candidates: ["alpha/", "alps/"] });
      expect(await completePath("~/gam")).toEqual({ completed: "~/gamma/", candidates: [] });
    } finally {
      homedir.mockRestore();
    }
  });
});
