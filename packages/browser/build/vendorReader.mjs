/**
 * Copies what the reader page loads at runtime into the per-target dist folder:
 * - pdf.js (legacy build, the one the VS Code reader uses) into vendor/pdfjs/{build,web,cmaps,standard_fonts,wasm,iccs};
 * - the shared reader stylesheet from @labshelf/reader into reader/reader.css.
 * pdf_viewer.mjs goes through esbuild (es2023): its `v`-flag regex makes the addons-linter behind `web-ext lint` fail.
 * @depends esbuild, pdfjs-dist, @labshelf/reader.
 * @dependents build.mjs.
 */
import { transform } from "esbuild";
import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

// pdf.sandbox.mjs is the only user of the QuickJS engine; the reader never loads it.
const SKIP_WASM = new Set(["quickjs-eval.js", "quickjs-eval.wasm"]);

async function copyDir(src, dst, skip = new Set()) {
  await mkdir(dst, { recursive: true });
  for (const entry of await readdir(src, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue;
    const s = join(src, entry.name);
    const d = join(dst, entry.name);
    if (entry.isDirectory()) await copyDir(s, d, skip);
    else await copyFile(s, d);
  }
}

export async function vendorReader({ outDir, pkgRoot }) {
  const require = createRequire(join(pkgRoot, "package.json"));
  const pdfjsRoot = dirname(require.resolve("pdfjs-dist/package.json"));
  const readerRoot = dirname(require.resolve("@labshelf/reader/package.json"));
  const vendor = join(outDir, "vendor", "pdfjs");

  await mkdir(join(vendor, "build"), { recursive: true });
  await mkdir(join(vendor, "web"), { recursive: true });
  await copyFile(join(pdfjsRoot, "legacy/build/pdf.min.mjs"), join(vendor, "build/pdf.min.mjs"));
  await copyFile(join(pdfjsRoot, "legacy/build/pdf.worker.min.mjs"), join(vendor, "build/pdf.worker.min.mjs"));
  const viewer = await readFile(join(pdfjsRoot, "legacy/web/pdf_viewer.mjs"), "utf8");
  const lowered = await transform(viewer, { loader: "js", format: "esm", target: "es2023" });
  await writeFile(join(vendor, "web/pdf_viewer.mjs"), lowered.code);
  await copyFile(join(pdfjsRoot, "legacy/web/pdf_viewer.css"), join(vendor, "web/pdf_viewer.css"));
  await copyDir(join(pdfjsRoot, "legacy/web/images"), join(vendor, "web/images"));
  for (const dir of ["cmaps", "standard_fonts", "iccs"]) {
    await copyDir(join(pdfjsRoot, dir), join(vendor, dir));
  }
  await copyDir(join(pdfjsRoot, "wasm"), join(vendor, "wasm"), SKIP_WASM);

  await mkdir(join(outDir, "reader"), { recursive: true });
  await copyFile(join(readerRoot, "src/webview/styles/reader.css"), join(outDir, "reader/reader.css"));
}
