/**
 * Copies manifests and static HTML/CSS files into the per-target dist folder.
 * @depends node:fs/promises.
 * @dependents build.mjs.
 */
import { copyFile, mkdir, readdir, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

async function copyDir(src, dst) {
  await mkdir(dst, { recursive: true });
  const entries = await readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const s = join(src, entry.name);
    const d = join(dst, entry.name);
    if (entry.isDirectory()) {
      await copyDir(s, d);
    } else {
      await copyFile(s, d);
    }
  }
}

async function exists(p) {
  try { await stat(p); return true; } catch { return false; }
}

const STATIC_EXTENSIONS = new Set([".html", ".css", ".svg", ".png", ".woff", ".woff2"]);

async function copyStaticFromSrc(src, dst) {
  const entries = await readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const s = join(src, entry.name);
    const d = join(dst, entry.name);
    if (entry.isDirectory()) {
      await copyStaticFromSrc(s, d);
    } else {
      const dot = entry.name.lastIndexOf(".");
      if (dot < 0) continue;
      const ext = entry.name.slice(dot).toLowerCase();
      if (STATIC_EXTENSIONS.has(ext)) {
        await mkdir(dst, { recursive: true });
        await copyFile(s, d);
      }
    }
  }
}

export async function copyAssets({ srcRoot, outDir, target, pkgRoot }) {
  const manifestSrc = resolve(pkgRoot, `manifest.${target}.json`);
  if (!(await exists(manifestSrc))) {
    throw new Error(`Missing manifest for target=${target}: ${relative(pkgRoot, manifestSrc)}`);
  }
  await copyFile(manifestSrc, join(outDir, "manifest.json"));

  await copyStaticFromSrc(srcRoot, outDir);

  const assetsSrc = resolve(srcRoot, "assets");
  if (await exists(assetsSrc)) {
    await copyDir(assetsSrc, join(outDir, "assets"));
  }
}
