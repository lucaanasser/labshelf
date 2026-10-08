/** Throwaway directories and file listings for tests that touch the real disk. */
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const created: string[] = [];

/** Creates a temp directory that cleanupTempDirs removes; returns its symlink-resolved path. */
export async function makeTempDir(prefix = "labshelf-core-"): Promise<string> {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), prefix)));
  created.push(dir);
  return dir;
}

/** Removes every directory made by makeTempDir. */
export async function cleanupTempDirs(): Promise<void> {
  const dirs = created.splice(0, created.length);
  await Promise.all(dirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
}

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
