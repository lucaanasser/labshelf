/**
 * Bundles the PDF reader webview runtime into dist/reader/reader.{js,css}. The reader UI lives in @labshelf/core/dom
 * (also bundled by the browser extension); src/reader/main.ts is its VS Code entry.
 */
import { build, context } from "esbuild";
import { mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, "..");
const outDir = resolve(pkgRoot, "dist", "reader");

const watch = process.argv.includes("--watch");
const production = process.argv.includes("--production");

const options = {
  entryPoints: { reader: resolve(pkgRoot, "src/reader/main.ts") },
  outdir: outDir,
  bundle: true,
  format: "esm",
  platform: "browser",
  // Matches the Chromium shipped with the Electron of engines.vscode ^1.98.
  target: ["chrome122"],
  // pdf.js is loaded at runtime by dynamic import() of webview URIs; only its
  // types are imported. A value import must fail loudly instead of silently
  // pulling ~1 MB into the bundle.
  external: ["pdfjs-dist", "pdfjs-dist/*"],
  minify: production,
  // External maps do not resolve through the webview resource scheme.
  sourcemap: production ? false : "inline",
  tsconfig: resolve(pkgRoot, "tsconfig.webview.json"),
  logLevel: "info",
};

async function main() {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  if (watch) {
    const ctx = await context(options);
    await ctx.watch();
    // eslint-disable-next-line no-console
    console.log(`[labshelf-reader] watching → ${outDir}`);
    return;
  }
  await build(options);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
