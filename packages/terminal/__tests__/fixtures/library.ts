/**
 * Test helpers: a throwaway LabShelf library on disk, laid out the way the VS Code extension lays it out
 * (papers/<collection…>/<paperId>/{metadata.yaml, paper.pdf, bib.bib} and .research/papers/<paperId>/data.json).
 */
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { parse, stringify } from "yaml";

import { LibraryRoot, ensureLibraryStructure } from "../../src/library/libraryRoot";

const created: string[] = [];

/**
 * Creates a temp directory that cleanupTempDirs removes.
 * @returns the real (symlink-resolved) path
 */
export async function makeTempDir(prefix = "labshelf-term-"): Promise<string> {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), prefix)));
  created.push(dir);
  return dir;
}

/** Removes every directory made by makeTempDir / createTempLibrary. */
export async function cleanupTempDirs(): Promise<void> {
  const dirs = created.splice(0, created.length);
  await Promise.all(dirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
}

/** Bytes that start like a real PDF; enough for every magic-number check in the app. */
export function fakePdfBytes(label = "paper"): Uint8Array {
  return new Uint8Array(Buffer.from(`%PDF-1.4\n% ${label}\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n`, "latin1"));
}

export interface PaperFixture {
  /** Folder name == paper id. */
  id: string;
  /** Collection path relative to papers/ ("ML/Vision"); omitted for the library root. */
  collection?: string;
  /** Title in metadata.yaml. Default "Title of <id>"; null leaves the key out. */
  title?: string | null;
  /** Extra metadata.yaml keys (authors, year, status, tags, doi, keys the terminal does not know…). */
  meta?: Record<string, unknown>;
  /** Raw metadata.yaml text; replaces the generated one. */
  rawMetadata?: string;
  /** true writes default PDF bytes, a string writes that content; absent writes no paper.pdf. */
  pdf?: boolean | string;
  /** Sidecar data.json: an object (written like the readers do) or raw text. */
  sidecar?: unknown;
  /** Write a placeholder bib.bib. */
  bib?: boolean;
}

export interface TempLibrary {
  root: string;
  paths: LibraryRoot;
  /** Absolute folder of a paper. */
  paperDir(id: string, collection?: string): string;
  addPaper(fixture: PaperFixture): Promise<string>;
  /** Creates an (empty) collection folder; returns its absolute path. */
  addCollection(rel: string): Promise<string>;
  writeSidecar(id: string, data: unknown): Promise<string>;
}

/**
 * Creates a temp library root with the standard folder structure and the given papers.
 * @returns helpers bound to the new library
 */
export async function createTempLibrary(
  papers: PaperFixture[] = [],
  options: { structure?: boolean } = {},
): Promise<TempLibrary> {
  const root = await makeTempDir();
  const paths = new LibraryRoot(root);
  if (options.structure !== false) { await ensureLibraryStructure(paths); }

  const lib: TempLibrary = {
    root,
    paths,
    paperDir: (id, collection = "") => path.join(paths.collectionDir(collection), id),
    async addPaper(fixture) {
      const folder = lib.paperDir(fixture.id, fixture.collection);
      await fs.mkdir(folder, { recursive: true });
      const metadata = fixture.rawMetadata ?? stringify({
        ...(fixture.title === null ? {} : { title: fixture.title ?? `Title of ${fixture.id}` }),
        citekey: fixture.id,
        ...(fixture.meta ?? {}),
      });
      await fs.writeFile(path.join(folder, "metadata.yaml"), metadata);
      if (fixture.pdf) {
        const content = typeof fixture.pdf === "string" ? fixture.pdf : fakePdfBytes(fixture.id);
        await fs.writeFile(path.join(folder, "paper.pdf"), content);
      }
      if (fixture.bib) { await fs.writeFile(path.join(folder, "bib.bib"), `@article{${fixture.id},\n}\n`); }
      if (fixture.sidecar !== undefined) { await lib.writeSidecar(fixture.id, fixture.sidecar); }
      return folder;
    },
    async addCollection(rel) {
      const dir = paths.collectionDir(rel);
      await fs.mkdir(dir, { recursive: true });
      return dir;
    },
    async writeSidecar(id, data) {
      const file = paths.layout.paperDataPath(id);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, typeof data === "string" ? data : JSON.stringify(data, null, 2));
      return file;
    },
  };
  for (const paper of papers) { await lib.addPaper(paper); }
  return lib;
}

/** Reads and parses a YAML file as a plain object. */
export async function readYaml(file: string): Promise<Record<string, unknown>> {
  return parse(await fs.readFile(file, "utf8")) as Record<string, unknown>;
}

/** Sets a file's modification time. */
export async function setMtime(file: string, when: Date): Promise<void> {
  await fs.utimes(file, when, when);
}

/** Whether a path exists. */
export async function pathExists(target: string): Promise<boolean> {
  return fs.stat(target).then(() => true, () => false);
}

/** Every file under a directory, as "/"-separated paths relative to it (sorted). */
export async function listFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(current: string, rel: string): Promise<void> {
    const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) { await walk(path.join(current, entry.name), childRel); } else { out.push(childRel); }
    }
  }
  await walk(dir, "");
  return out.sort();
}
