/**
 * Bundles the @labshelf/browser MV3 extension for chrome and firefox targets.
 * @depends esbuild, copyAssets.mjs, vendorReader.mjs.
 * @dependents pnpm --filter @labshelf/browser build.
 */
import { build as esbuild } from "esbuild";
import { mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { copyAssets } from "./copyAssets.mjs";
import { vendorReader } from "./vendorReader.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, "..");
const srcRoot = resolve(pkgRoot, "src");
const outRoot = resolve(pkgRoot, "dist");

const ENTRIES = [
  { entry: "background/index.ts", out: "background/index.js", format: "esm" },
  { entry: "popup/index.ts", out: "popup/index.js", format: "esm" },
  { entry: "options/index.ts", out: "options/index.js", format: "esm" },
  { entry: "library-page/index.ts", out: "library-page/index.js", format: "esm" },
  // The PDF reader page: the shared reader UI from @labshelf/core/dom over an in-page host.
  { entry: "reader/index.ts", out: "reader/index.js", format: "esm" },
  // Classic script: runs in <head> before the stylesheets so the theme is set pre-paint.
  { entry: "ui/themeBoot.ts", out: "ui/themeBoot.js", format: "iife" },
  // Content scripts are classic scripts too: no module loading in page worlds.
  { entry: "content/scholar.ts", out: "content/scholar.js", format: "iife" },
];

const TARGETS = ["chrome", "firefox"];

function parseTargetFlag() {
  const arg = process.argv.find((a) => a.startsWith("--target="));
  if (!arg) return null;
  const value = arg.slice("--target=".length);
  if (!TARGETS.includes(value)) {
    throw new Error(`Unknown --target=${value}. Expected one of: ${TARGETS.join(", ")}`);
  }
  return value;
}

async function buildOne(target) {
  const outDir = resolve(outRoot, target);
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  await Promise.all(
    ENTRIES.map((e) =>
      esbuild({
        entryPoints: [resolve(srcRoot, e.entry)],
        outfile: resolve(outDir, e.out),
        bundle: true,
        format: e.format,
        // pdf.js 6.3 (the reader) needs Chrome 125 / Firefox 128; the manifests declare the same minimums.
        target: ["chrome125", "firefox128"],
        platform: "browser",
        sourcemap: true,
        // A stylesheet imported from TS is its text (shadow-root styles in content scripts).
        loader: { ".css": "text" },
        define: {
          "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV ?? "production"),
        },
        logLevel: "info",
      })
    )
  );

  await copyAssets({ srcRoot, outDir, target, pkgRoot });
  await vendorReader({ outDir, pkgRoot });
  // eslint-disable-next-line no-console
  console.log(`[labshelf-browser] built ${target} → ${outDir}`);
}

async function main() {
  const single = parseTargetFlag();
  const targets = single ? [single] : TARGETS;
  for (const t of targets) {
    await buildOne(t);
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
