import { promises as fs } from "node:fs";
import * as path from "node:path";

import { openLibrary, type AppContext } from "../../src/app/context";
import type { SharedConfig } from "../../src/app/config";
import { parseArgs } from "../../src/cli/args";
import { UsageError, runDoctor, runLibraryCommand, type Output } from "../../src/cli/commands";
import {
  cleanupTempDirs,
  createTempLibrary,
  makeTempDir,
  pathExists,
  readYaml,
  type PaperFixture,
  type TempLibrary,
} from "../fixtures/library";

const ENV_KEYS = ["XDG_CONFIG_HOME", "XDG_CACHE_HOME", "LABSHELF_TOKEN_STORE", "LABSHELF_IMAGES", "LABSHELF_GOOGLE_CLIENT_ID", "LABSHELF_GOOGLE_CLIENT_SECRET", "LABSHELF_PDF_VIEWER"];
const saved: Record<string, string | undefined> = {};
const opened: AppContext[] = [];
let xdgConfig = "";
let xdgCache = "";

beforeEach(async () => {
  for (const key of ENV_KEYS) { saved[key] = process.env[key]; }
  xdgConfig = await makeTempDir("labshelf-xdgc-");
  xdgCache = await makeTempDir("labshelf-xdgx-");
  // The file token store resolves its folder from process.env, so keep the real ~/.config out of every test.
  process.env["XDG_CONFIG_HOME"] = xdgConfig;
  process.env["XDG_CACHE_HOME"] = xdgCache;
  process.env["LABSHELF_TOKEN_STORE"] = "file";
  process.env["LABSHELF_IMAGES"] = "off";
  delete process.env["LABSHELF_PDF_VIEWER"];
  process.env["LABSHELF_GOOGLE_CLIENT_ID"] = "test-client-id-0123456789";
});

afterEach(async () => {
  await Promise.all(opened.splice(0).map((ctx) => ctx.dispose()));
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) { delete process.env[key]; } else { process.env[key] = saved[key]; }
  }
  await cleanupTempDirs();
});

const NOW = "2025-01-01T00:00:00.000Z";

function highlight(id: string, page: number, content: string): Record<string, unknown> {
  return {
    id, paperId: "vaswani2017attention", type: "highlight", pageNumber: page, content, color: "yellow",
    position: { x: 0.1, y: 0.1, width: 0.2, height: 0.05 }, createdAt: NOW, updatedAt: NOW,
  };
}

const PAPERS: PaperFixture[] = [
  {
    id: "vaswani2017attention",
    collection: "ML",
    title: "Attention Is All You Need",
    pdf: "%PDF-1.4 attention",
    meta: {
      authors: ["Ashish Vaswani", "Noam Shazeer"], year: 2017, status: "unread", tags: ["nlp"], doi: "10.5555/3295222.3295349",
      journal: "NeurIPS", summary: "The Transformer.", note: "Read section 3", vscodeOnly: { keep: true },
    },
    sidecar: {
      annotations: [highlight("h2", 2, "positional encodings"), highlight("h1", 1, "self-attention replaces recurrence")],
      theme: "dark",
      reading: { page: 7, scaleValue: "1.25", updatedAt: NOW },
    },
  },
  { id: "devlin2019bert", collection: "ML/Language", title: "BERT: Pre-training", pdf: true, meta: { authors: ["Jacob Devlin"], year: 2019, status: "reading", tags: ["nlp", "pretraining"] } },
  { id: "he2016resnet", collection: "ML/Vision", title: "Deep Residual Learning", meta: { authors: ["Kaiming He"], year: 2016, status: "done", doi: "10.1109/CVPR.2016.90" } },
  { id: "notes2020", title: "Loose notes", meta: { year: 2020 } },
];

interface Session {
  lib: TempLibrary;
  ctx: AppContext;
  out: string[];
  err: string[];
  /** Runs one command line and returns its exit code. */
  run(...argv: string[]): Promise<number>;
  text(): string;
  errText(): string;
}

async function session(papers: PaperFixture[] = PAPERS, options: { config?: SharedConfig; env?: Record<string, string>; columns?: number; collections?: string[]; prepare?: (lib: TempLibrary) => Promise<void> } = {}): Promise<Session> {
  const lib = await createTempLibrary(papers);
  for (const rel of options.collections ?? []) { await lib.addCollection(rel); }
  await options.prepare?.(lib);
  const env: NodeJS.ProcessEnv = {
    XDG_CONFIG_HOME: xdgConfig,
    XDG_CACHE_HOME: xdgCache,
    LABSHELF_TOKEN_STORE: "file",
    LABSHELF_IMAGES: "off",
    LABSHELF_GOOGLE_CLIENT_ID: "test-client-id-0123456789",
    ...(process.env["PATH"] ? { PATH: process.env["PATH"] } : {}),
    ...(options.env ?? {}),
  };
  const ctx = await openLibrary(lib.root, { config: options.config ?? { version: 1 }, env, watch: false, thumbnailWorkerUrl: new URL("file:///unused/thumbnailWorker.mjs") });
  opened.push(ctx);
  const out: string[] = [];
  const err: string[] = [];
  const io: Output = { out: (t) => out.push(t), err: (t) => err.push(t), columns: options.columns ?? 100 };
  return {
    lib, ctx, out, err,
    run: (...argv) => runLibraryCommand(ctx, parseArgs(argv), io),
    text: () => out.join("\n"),
    errText: () => err.join("\n"),
  };
}

describe("ls", () => {
  it("lists sub-collections with their paper counts, then the papers, as a table", async () => {
    const s = await session();
    expect(await s.run("ls")).toBe(0);
    const lines = s.text().split("\n");
    expect(lines[0]).toBe("  ML/ (3)");
    expect(lines[1]).toMatch(/^○ 2020 {2}notes2020 {2}Loose notes$/);
    expect(lines).toHaveLength(2);
  });

  it("lists one collection: its sub-collections first, then its own papers with status glyph, year, id and title", async () => {
    const s = await session();
    expect(await s.run("ls", "ML")).toBe(0);
    expect(s.text().split("\n")).toEqual([
      "  Language/ (1)",
      "  Vision/ (1)",
      "○ 2017  vaswani2017attention  Attention Is All You Need",
    ]);
  });

  it("accepts papers/ML and a trailing slash for the collection", async () => {
    const s = await session();
    await s.run("ls", "papers/ML/Vision/");
    expect(s.text()).toContain("he2016resnet");
    expect(s.text()).toContain("●");
  });

  it("shows every paper below the collection with -r, without sub-collection lines", async () => {
    const s = await session();
    expect(await s.run("ls", "ML", "-r")).toBe(0);
    const lines = s.text().split("\n");
    expect(lines).toHaveLength(3);
    expect(lines.map((l) => l.split(/\s{2,}/)[1])).toEqual(["vaswani2017attention", "devlin2019bert", "he2016resnet"]);
    expect(s.text()).not.toContain("/ (");
  });

  it("also accepts --all and the list alias", async () => {
    const s = await session();
    await s.run("list", "--all");
    expect(s.text().split("\n")).toHaveLength(4);
  });

  it("prints (empty) for an empty collection", async () => {
    const s = await session(PAPERS, { collections: ["Empty"] });
    expect(await s.run("ls", "Empty")).toBe(0);
    expect(s.text()).toBe("(empty)");
  });

  it("fails with a usage error for an unknown collection", async () => {
    const s = await session();
    await expect(s.run("ls", "Nowhere")).rejects.toThrow(new UsageError('No collection "Nowhere"'));
  });

  it("prints --json: sub-collections with path, name and count, papers with their record, collection and pdf size", async () => {
    const s = await session();
    expect(await s.run("ls", "ML", "--json")).toBe(0);
    const entries = JSON.parse(s.text()) as Array<Record<string, unknown>>;
    expect(entries.slice(0, 2)).toEqual([
      { kind: "collection", path: "ML/Language", name: "Language", papers: 1 },
      { kind: "collection", path: "ML/Vision", name: "Vision", papers: 1 },
    ]);
    expect(entries[2]).toMatchObject({
      kind: "paper", id: "vaswani2017attention", title: "Attention Is All You Need", status: "unread", year: 2017,
      authors: ["Ashish Vaswani", "Noam Shazeer"], tags: ["nlp"], collection: "ML", hasPdf: true, pdfBytes: "%PDF-1.4 attention".length,
    });
  });

  it("prints -r --json as a flat array with pdfBytes null for papers without a PDF", async () => {
    const s = await session();
    await s.run("ls", "-r", "--json");
    const papers = JSON.parse(s.text()) as Array<{ id: string; pdfBytes: number | null; hasPdf: boolean; collection: string }>;
    expect(papers.map((p) => p.id)).toEqual(["vaswani2017attention", "devlin2019bert", "he2016resnet", "notes2020"].sort((a, b) => {
      const title = (id: string): string => PAPERS.find((x) => x.id === id)!.title ?? "";
      return title(a).localeCompare(title(b));
    }));
    const resnet = papers.find((p) => p.id === "he2016resnet")!;
    expect(resnet).toMatchObject({ hasPdf: false, pdfBytes: null, collection: "ML/Vision" });
  });

  it("sorts with --sort (year newest first, a ! suffix reverses) and falls back to the title for an unknown key", async () => {
    const s = await session();
    const ids = async (...args: string[]): Promise<string[]> => {
      s.out.length = 0;
      await s.run("ls", "ML", "-r", "--json", ...args);
      return (JSON.parse(s.text()) as Array<{ id: string }>).map((p) => p.id);
    };
    expect(await ids("--sort", "year")).toEqual(["devlin2019bert", "vaswani2017attention", "he2016resnet"]);
    expect(await ids("--sort", "year!")).toEqual(["he2016resnet", "vaswani2017attention", "devlin2019bert"]);
    expect(await ids("--sort=title")).toEqual(["vaswani2017attention", "devlin2019bert", "he2016resnet"]);
    expect(await ids("--sort", "bogus")).toEqual(["vaswani2017attention", "devlin2019bert", "he2016resnet"]);
  });

  it("uses the sort from the config file when --sort is not given", async () => {
    const s = await session(PAPERS, { config: { version: 1, terminal: { sort: "year" } } });
    await s.run("ls", "ML", "-r", "--json");
    expect((JSON.parse(s.text()) as Array<{ id: string }>).map((p) => p.id)).toEqual(["devlin2019bert", "vaswani2017attention", "he2016resnet"]);
  });

  it("truncates long titles to the terminal width", async () => {
    const s = await session(PAPERS, { columns: 40 });
    await s.run("ls", "ML");
    const line = s.text().split("\n").find((l) => l.includes("vaswani2017attention"))!;
    expect(line).not.toContain("All You Need");
    expect(line).toContain("…");
  });
});

describe("search", () => {
  it("prints the matching papers as a table and exits 0", async () => {
    const s = await session();
    expect(await s.run("search", "attention")).toBe(0);
    expect(s.text().split("\n")).toEqual(["○ 2017  vaswani2017attention  Attention Is All You Need"]);
  });

  it("joins several words and understands the query operators", async () => {
    const s = await session();
    expect(await s.run("search", "tag:nlp", "is:reading")).toBe(0);
    expect(s.text()).toContain("devlin2019bert");
    expect(s.text()).not.toContain("vaswani2017attention");

    s.out.length = 0;
    await s.run("find", "year:2015..2017", "has:doi");
    expect(s.text().split("\n").map((l) => l.split(/\s{2,}/)[1]).sort()).toEqual(["he2016resnet", "vaswani2017attention"]);
  });

  it("prints 'No match.' and exits 1 when nothing matches", async () => {
    const s = await session();
    expect(await s.run("search", "zzzznothing")).toBe(1);
    expect(s.text()).toBe("No match.");
  });

  it("prints --json results, and [] with exit 1 for no match", async () => {
    const s = await session();
    expect(await s.run("search", "bert", "--json")).toBe(0);
    expect((JSON.parse(s.text()) as Array<{ id: string; collection: string }>).map((p) => [p.id, p.collection])).toEqual([["devlin2019bert", "ML/Language"]]);

    s.out.length = 0;
    expect(await s.run("search", "zzzz", "--json")).toBe(1);
    expect(JSON.parse(s.text())).toEqual([]);
  });

  it("finds a paper through the text of its highlights once the annotation index is loaded", async () => {
    const s = await session();
    s.ctx.store.setAnnotationText(await s.ctx.sidecars.annotationIndex(s.ctx.store.snapshot.papers.keys()));
    expect(await s.run("search", "positional", "encodings")).toBe(0);
    expect(s.text()).toContain("vaswani2017attention");
  });

  // Regression: a one-shot search used to run before the background annotation index was ready.
  it("finds a paper through highlight text in a one-shot CLI run, without waiting", async () => {
    const many: PaperFixture[] = Array.from({ length: 40 }, (_, i) => ({
      id: `p${i}`,
      sidecar: { annotations: [{ ...highlight(`h${i}`, 1, i === 39 ? "uniquehighlightphrase" : `filler ${i}`), paperId: `p${i}` }], theme: "auto" },
    }));
    const s = await session(many);
    expect(await s.run("search", "uniquehighlightphrase")).toBe(0);
  });
});

describe("show", () => {
  it("prints the details of a paper: authors, venue, id, status, tags, doi, collection, PDF, highlights and reading position", async () => {
    const s = await session();
    expect(await s.run("show", "vaswani2017attention")).toBe(0);
    const lines = s.text().split("\n");
    expect(lines.slice(0, 3)).toEqual(["Attention Is All You Need", "Ashish Vaswani, Noam Shazeer", "NeurIPS · 2017"]);
    expect(lines).toContain("id     vaswani2017attention");
    expect(lines).toContain("status ○ unread");
    expect(lines).toContain("tags   nlp");
    expect(lines).toContain("doi    10.5555/3295222.3295349");
    expect(lines).toContain("in     ML");
    expect(lines).toContain(`pdf    ${path.join(s.lib.paperDir("vaswani2017attention", "ML"), "paper.pdf")} (18 B)`);
    expect(lines).toContain("notes  2 highlight(s)");
    expect(lines).toContain("read   stopped at page 7");
    expect(lines).toContain("note:");
    expect(lines).toContain("Read section 3");
    expect(lines).toContain("The Transformer.");
  });

  it("says when the PDF is not on this device, and names the library root for uncollected papers", async () => {
    const s = await session();
    await s.run("show", "he2016resnet");
    expect(s.text()).toContain("pdf    not on this device");
    s.out.length = 0;
    await s.run("show", "notes2020");
    expect(s.text()).toContain("in     (library root)");
  });

  it("finds a paper by cite key when the folder has another name", async () => {
    const s = await session([{ id: "folder-name", title: "Odd One", meta: { citekey: "custom-key" } }]);
    expect(await s.run("show", "custom-key")).toBe(0);
    expect(s.text()).toContain("id     folder-name");
  });

  it("prints --json with the record, annotations in page order, and the reading position", async () => {
    const s = await session();
    expect(await s.run("show", "vaswani2017attention", "--json")).toBe(0);
    const data = JSON.parse(s.text()) as Record<string, unknown> & { annotations: Array<{ id: string; content: string }> };
    expect(data).toMatchObject({ id: "vaswani2017attention", title: "Attention Is All You Need", collection: "ML", hasPdf: true, doi: "10.5555/3295222.3295349" });
    expect(data.annotations.map((a) => a.id)).toEqual(["h1", "h2"]);
    expect(data.annotations[0]!.content).toBe("self-attention replaces recurrence");
    expect(data["reading"]).toMatchObject({ page: 7, scaleValue: "1.25" });
  });

  it("prints reading: null and no annotations for a paper without a sidecar", async () => {
    const s = await session();
    await s.run("show", "notes2020", "--json");
    expect(JSON.parse(s.text())).toMatchObject({ id: "notes2020", annotations: [], reading: null });
  });

  it("fails with a usage error for an unknown or missing id", async () => {
    const s = await session();
    await expect(s.run("show", "ghost")).rejects.toThrow(new UsageError('No paper with id "ghost"'));
    await expect(s.run("show")).rejects.toBeInstanceOf(UsageError);
  });
});

describe("add", () => {
  it("needs something to add", async () => {
    const s = await session();
    await expect(s.run("add")).rejects.toThrow(/add needs at least one/);
  });

  it("rejects an unknown --to collection", async () => {
    const s = await session();
    await expect(s.run("add", "--to", "Nowhere", "x.pdf")).rejects.toThrow(new UsageError('No collection "Nowhere"'));
  });

  it("exits 1 and reports each failure on stderr (a path that is not a file and holds no identifier)", async () => {
    const s = await session();
    expect(await s.run("add", path.join(s.lib.root, "does-not-exist.pdf"))).toBe(1);
    expect(s.errText()).toContain("failed ");
    expect(s.errText()).toContain("No DOI, arXiv id, PMID or ISBN found");
    expect(s.text()).toBe("");
  });

  it("exits 1 for a file that is not a PDF, reporting progress on stderr", async () => {
    const s = await session();
    const notPdf = path.join(s.lib.root, "notes.pdf");
    await fs.writeFile(notPdf, "plain text");
    expect(await s.run("add", notPdf, "--to", "ML")).toBe(1);
    expect(s.errText()).toContain(`[1/1] ${notPdf}`);
    expect(s.errText()).toContain("Not a PDF file");
    expect((await fs.readdir(s.lib.paths.collectionDir("ML"))).sort()).toEqual(["Language", "Vision", "vaswani2017attention"]);
  });
});

describe("bib", () => {
  it("prints the BibTeX of the given papers to stdout, without the local file line", async () => {
    const s = await session();
    expect(await s.run("bib", "vaswani2017attention")).toBe(0);
    const text = s.text();
    expect(text.startsWith("@article{vaswani2017attention,")).toBe(true);
    expect(text).toContain("  title = {Attention Is All You Need},");
    expect(text).toContain("  author = {Ashish Vaswani and Noam Shazeer},");
    expect(text).toContain("  doi = {10.5555/3295222.3295349},");
    expect(text).not.toContain("file =");
    expect(text.endsWith("}")).toBe(true);
  });

  it("separates several papers with a blank line", async () => {
    const s = await session();
    await s.run("bib", "devlin2019bert", "he2016resnet");
    expect(s.text()).toMatch(/\}\n\n@article\{he2016resnet,/);
    expect(s.text().indexOf("@article{devlin2019bert,")).toBeLessThan(s.text().indexOf("@article{he2016resnet,"));
  });

  it("without ids prints the whole library, or one collection with -c / --collection", async () => {
    const s = await session();
    await s.run("bib");
    expect((s.text().match(/@article\{/g) ?? []).length).toBe(4);

    s.out.length = 0;
    await s.run("bib", "-c", "ML");
    expect((s.text().match(/@article\{/g) ?? []).length).toBe(3);
    expect(s.text()).not.toContain("notes2020");

    s.out.length = 0;
    await s.run("bib", "--collection=ML/Vision");
    expect(s.text()).toContain("@article{he2016resnet,");
    expect((s.text().match(/@article\{/g) ?? []).length).toBe(1);
  });

  it("writes to a file with -o, prints nothing on stdout, and says how many entries went where", async () => {
    const s = await session();
    const target = path.join(await makeTempDir(), "refs.bib");
    expect(await s.run("bib", "-c", "ML", "-o", target)).toBe(0);
    expect(s.text()).toBe("");
    expect(s.errText()).toBe(`3 entries written to ${target}`);
    const file = await fs.readFile(target, "utf8");
    expect(file.endsWith("}\n")).toBe(true);
    expect(file).toContain("@article{he2016resnet,");
    expect(file).not.toContain("file =");
  });

  it("fails with a usage error for an unknown paper or collection", async () => {
    const s = await session();
    await expect(s.run("bib", "ghost")).rejects.toBeInstanceOf(UsageError);
    await expect(s.run("bib", "-c", "Nope")).rejects.toBeInstanceOf(UsageError);
  });
});

describe("open", () => {
  it("exits 1 for a paper without a PDF and points at its DOI link", async () => {
    const s = await session();
    expect(await s.run("open", "he2016resnet")).toBe(1);
    expect(s.errText()).toBe("No PDF on this device for he2016resnet (https://doi.org/10.1109/CVPR.2016.90)");
  });

  it("exits 1 without a link when the paper has no DOI or URL", async () => {
    const s = await session([{ id: "bare1", title: "Bare" }]);
    expect(await s.run("open", "bare1")).toBe(1);
    expect(s.errText()).toBe("No PDF on this device for bare1");
  });

  it("fails with a usage error for an unknown paper", async () => {
    const s = await session();
    await expect(s.run("open", "ghost")).rejects.toBeInstanceOf(UsageError);
  });
});

describe("status", () => {
  it("changes the status on disk, keeping every other field", async () => {
    const s = await session();
    expect(await s.run("status", "vaswani2017attention", "reading")).toBe(0);
    const yaml = await readYaml(path.join(s.lib.paperDir("vaswani2017attention", "ML"), "metadata.yaml"));
    expect(yaml["status"]).toBe("reading");
    expect(yaml).toMatchObject({ tags: ["nlp"], note: "Read section 3", journal: "NeurIPS", vscodeOnly: { keep: true } });
    expect(s.ctx.store.paper("vaswani2017attention")!.record.status).toBe("reading");
  });

  it("sets several papers at once and understands u / r / d and any case", async () => {
    const s = await session();
    expect(await s.run("status", "devlin2019bert", "he2016resnet", "D")).toBe(0);
    expect(s.ctx.store.paper("devlin2019bert")!.record.status).toBe("done");
    expect(s.ctx.store.paper("he2016resnet")!.record.status).toBe("done");
    await s.run("status", "he2016resnet", "u");
    expect(s.ctx.store.paper("he2016resnet")!.record.status).toBe("unread");
    await s.run("status", "he2016resnet", "READING");
    expect((await readYaml(path.join(s.lib.paperDir("he2016resnet", "ML/Vision"), "metadata.yaml")))["status"]).toBe("reading");
  });

  it("resolves a cite key to the paper", async () => {
    const s = await session([{ id: "folder-name", title: "Odd One", meta: { citekey: "custom-key" } }]);
    expect(await s.run("status", "custom-key", "done")).toBe(0);
    expect(s.ctx.store.paper("folder-name")!.record.status).toBe("done");
  });

  it("is a usage error without ids, with an unknown status word, or for an unknown paper", async () => {
    const s = await session();
    await expect(s.run("status", "reading")).rejects.toThrow(/Usage: labshelf status/);
    await expect(s.run("status", "devlin2019bert")).rejects.toThrow(/Usage: labshelf status/);
    await expect(s.run("status", "devlin2019bert", "finished")).rejects.toThrow(/Usage: labshelf status/);
    await expect(s.run("status", "ghost", "done")).rejects.toBeInstanceOf(UsageError);
  });
});

describe("tag", () => {
  it("adds and removes tags in one call, keeping the others", async () => {
    const s = await session();
    expect(await s.run("tag", "devlin2019bert", "+transformers", "-nlp")).toBe(0);
    expect((await readYaml(path.join(s.lib.paperDir("devlin2019bert", "ML/Language"), "metadata.yaml")))["tags"]).toEqual(["pretraining", "transformers"]);
    expect(s.ctx.store.paper("devlin2019bert")!.record.tags).toEqual(["pretraining", "transformers"]);
  });

  it("tags several papers, with the +tag tokens anywhere on the line", async () => {
    const s = await session();
    expect(await s.run("tag", "+reviewed", "he2016resnet", "notes2020")).toBe(0);
    expect(s.ctx.store.paper("he2016resnet")!.record.tags).toEqual(["reviewed"]);
    expect(s.ctx.store.paper("notes2020")!.record.tags).toEqual(["reviewed"]);
  });

  it("removing the last tag drops the tags key", async () => {
    const s = await session();
    await s.run("tag", "vaswani2017attention", "-NLP");
    expect(await readYaml(path.join(s.lib.paperDir("vaswani2017attention", "ML"), "metadata.yaml"))).not.toHaveProperty("tags");
  });

  it("is a usage error without ids or without a +tag / -tag, and for an unknown paper", async () => {
    const s = await session();
    await expect(s.run("tag", "+x")).rejects.toThrow(/Usage: labshelf tag/);
    await expect(s.run("tag", "devlin2019bert")).rejects.toThrow(/Usage: labshelf tag/);
    await expect(s.run("tag", "ghost", "+x")).rejects.toBeInstanceOf(UsageError);
  });
});

describe("mv", () => {
  it("moves papers on disk into the target collection", async () => {
    const s = await session();
    expect(await s.run("mv", "devlin2019bert", "he2016resnet", "ML")).toBe(0);
    for (const id of ["devlin2019bert", "he2016resnet"]) {
      expect(await pathExists(path.join(s.lib.paperDir(id, "ML"), "metadata.yaml"))).toBe(true);
      expect(s.ctx.store.paper(id)!.collection).toBe("ML");
    }
    expect(await pathExists(s.lib.paperDir("devlin2019bert", "ML/Language"))).toBe(false);
  });

  it("moves to the library root with 'papers'", async () => {
    const s = await session();
    expect(await s.run("mv", "devlin2019bert", "papers")).toBe(0);
    expect(s.ctx.store.paper("devlin2019bert")!.collection).toBe("");
    expect(await pathExists(path.join(s.lib.paths.papersRoot(), "devlin2019bert", "metadata.yaml"))).toBe(true);
  });

  it("exits 1 and reports a name clash on stderr, leaving the paper where it was", async () => {
    const s = await session(PAPERS, {
      prepare: async (lib) => { await fs.mkdir(path.join(lib.paths.collectionDir("ML/Vision"), "devlin2019bert"), { recursive: true }); },
    });
    expect(await s.run("mv", "devlin2019bert", "ML/Vision")).toBe(1);
    expect(s.errText()).toBe('devlin2019bert: "devlin2019bert" already exists there');
    expect(s.ctx.store.paper("devlin2019bert")!.collection).toBe("ML/Language");
  });

  it("is a usage error for a missing target, an unknown collection, or an unknown paper", async () => {
    const s = await session();
    await expect(s.run("mv", "devlin2019bert")).rejects.toThrow(/Usage: labshelf mv/);
    await expect(s.run("mv", "devlin2019bert", "Nowhere")).rejects.toThrow(new UsageError('No collection "Nowhere"'));
    await expect(s.run("mv", "ghost", "ML")).rejects.toBeInstanceOf(UsageError);
  });
});

describe("sync and auth (offline paths only)", () => {
  async function signIn(): Promise<void> {
    const dir = path.join(xdgConfig, "labshelf");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "credentials.json"), JSON.stringify({ access_token: "a", refresh_token: "r", expiry_ms: Date.now() + 3_600_000 }), { mode: 0o600 });
  }

  it("sync skips with exit 1 and a hint when not signed in", async () => {
    const s = await session();
    expect(await s.run("sync")).toBe(1);
    expect(s.errText()).toBe("sync skipped: not signed in to Google Drive — run `labshelf auth login`");
  });

  it("sync skips without a hint when no OAuth client is configured", async () => {
    const s = await session(PAPERS, { env: { LABSHELF_GOOGLE_CLIENT_ID: "YOUR_GOOGLE_OAUTH_CLIENT_ID" } });
    expect(await s.run("sync")).toBe(1);
    expect(s.errText()).toBe("sync skipped: no Google OAuth client configured");
  });

  it("sync --json prints the outcome", async () => {
    const s = await session();
    expect(await s.run("sync", "--json")).toBe(1);
    expect(JSON.parse(s.text())).toEqual({ kind: "skipped", reason: "not signed in to Google Drive" });
  });

  it("sync reports VS Code as the holder while it syncs this library, without touching Drive", async () => {
    await signIn();
    const info = { app: "vscode", pid: 424242, host: "another-computer", token: "t", acquiredAt: new Date().toISOString(), heartbeatAt: new Date().toISOString() };
    const s = await session(PAPERS, { prepare: async (lib) => { await fs.writeFile(lib.paths.lockPath(), JSON.stringify(info)); } });
    expect(await s.run("sync")).toBe(1);
    expect(s.errText()).toBe("VS Code is syncing this library right now.");
    expect(s.ctx.sync.status().state).toBe("waiting");
    expect(JSON.parse(await fs.readFile(s.lib.paths.lockPath(), "utf8"))).toMatchObject({ app: "vscode", token: "t" });
  });

  it("sync names another LabShelf app when that is the holder", async () => {
    await signIn();
    const info = { app: "browser", pid: 424242, host: "another-computer", token: "t", acquiredAt: new Date().toISOString(), heartbeatAt: new Date().toISOString() };
    const s = await session(PAPERS, { prepare: async (lib) => { await fs.writeFile(lib.paths.lockPath(), JSON.stringify(info)); } });
    expect(await s.run("sync")).toBe(1);
    expect(s.errText()).toBe("Another LabShelf app is syncing this library right now.");
  });

  it("auth status shows signed out / signed in and the last sync by any app", async () => {
    const lastRun = {
      providerId: "google-drive", app: "vscode", host: "laptop", startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
      uploaded: 1, downloaded: 0, deletedLocal: 0, deletedRemote: 0, conflicts: [],
    };
    const out = await session(PAPERS, { prepare: async (lib) => { await fs.writeFile(lib.paths.lastRunPath(), JSON.stringify(lastRun)); } });
    expect(await out.run("auth", "status")).toBe(0);
    expect(out.out).toEqual(["drive:     signed out", "last sync: just now by vscode on laptop"]);

    await signIn();
    const inn = await session();
    await inn.run("auth");
    expect(inn.out).toEqual(["drive:     signed in", "last sync: never"]);
  });

  it("auth status says so when no OAuth client is configured", async () => {
    const s = await session(PAPERS, { env: { LABSHELF_GOOGLE_CLIENT_ID: "YOUR_GOOGLE_OAUTH_CLIENT_ID" } });
    await s.run("auth", "status");
    expect(s.out[0]).toBe("drive:     no OAuth client configured");
  });

  it("auth logout while signed out is harmless and prints a confirmation", async () => {
    const s = await session();
    expect(await s.run("auth", "logout")).toBe(0);
    expect(s.text()).toBe("Signed out. The library stays on this computer.");
  });

  it("auth with an unknown subcommand is a usage error", async () => {
    const s = await session();
    await expect(s.run("auth", "frobnicate")).rejects.toThrow(/Usage: labshelf auth login \| logout \| status/);
  });
});

describe("unknown commands", () => {
  it("throws a UsageError that names the command", async () => {
    const s = await session();
    const error = await s.run("frobnicate").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UsageError);
    expect((error as Error).message).toBe('Unknown command "frobnicate". Run labshelf --help.');
  });
});

describe("read-only commands do not modify the library", () => {
  it("leaves every metadata.yaml byte-for-byte alone", async () => {
    const s = await session();
    const files = ["vaswani2017attention@ML", "devlin2019bert@ML/Language", "he2016resnet@ML/Vision", "notes2020@"].map((x) => {
      const [id, collection] = x.split("@") as [string, string];
      return path.join(s.lib.paperDir(id, collection), "metadata.yaml");
    });
    const before = await Promise.all(files.map((f) => fs.readFile(f, "utf8")));
    for (const argv of [["ls"], ["ls", "-r"], ["search", "nlp"], ["show", "vaswani2017attention"], ["bib"], ["auth", "status"]]) {
      await s.run(...argv);
    }
    expect(await Promise.all(files.map((f) => fs.readFile(f, "utf8")))).toEqual(before);
  });
});

describe("runDoctor", () => {
  function capture(): { io: Output; text: () => string } {
    const lines: string[] = [];
    return { io: { out: (t) => lines.push(t), err: (t) => lines.push(t), columns: 100 }, text: () => lines.join("\n") };
  }

  it("passes for a configured library and reports each check on its own line", async () => {
    const lib = await createTempLibrary(PAPERS);
    const { io, text } = capture();
    expect(await runDoctor(lib.root, "flag", { version: 1, libraryRoot: lib.root }, io)).toBe(0);
    expect(text()).toMatch(/^ok {2}\s+node\s+v\d+/m);
    expect(text()).toMatch(new RegExp(`^ok {2}\\s+library\\s+${lib.root.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")} \\(from flag\\)$`, "m"));
    expect(text()).toContain("configured (test-client-");
    expect(text()).toMatch(/^warn\s+drive sign-in\s+signed out/m);
    expect(text()).toMatch(/^warn\s+last sync\s+never/m);
  });

  it("fails when no library is configured", async () => {
    const { io, text } = capture();
    expect(await runDoctor(undefined, "none", { version: 1 }, io)).toBe(1);
    expect(text()).toMatch(/^FAIL\s+library\s+not configured/m);
    expect(text()).toContain("no libraryRoot yet");
  });

  it("fails when the configured folder has no papers/ folder", async () => {
    const empty = await makeTempDir();
    const { io, text } = capture();
    expect(await runDoctor(empty, "env", { version: 1 }, io)).toBe(1);
    expect(text()).toMatch(/^FAIL\s+library/m);
  });

  it("warns about a held sync lock and shows the last sync", async () => {
    const lib = await createTempLibrary();
    await fs.writeFile(lib.paths.lockPath(), JSON.stringify({ app: "vscode", pid: 1 }));
    await fs.writeFile(lib.paths.lastRunPath(), JSON.stringify({ app: "vscode", finishedAt: new Date().toISOString() }));
    const { io, text } = capture();
    expect(await runDoctor(lib.root, "config", { version: 1 }, io)).toBe(0);
    expect(text()).toMatch(/^warn\s+sync lock\s+held: .*"app":"vscode"/m);
    expect(text()).toMatch(/^ok {2}\s+last sync\s+just now by vscode/m);
  });
});
