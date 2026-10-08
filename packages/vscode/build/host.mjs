/**
 * Bundles the extension host into out/extension.js. @labshelf/* packages are bundled from source; every other
 * dependency stays external and loads from node_modules, because pdf.js, Tesseract and the native canvas locate their
 * own data files, workers and binaries next to themselves.
 */
import { build, context } from "esbuild";
import { readFile, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, "..");
const outDir = resolve(pkgRoot, "out");

const watch = process.argv.includes("--watch");
const production = process.argv.includes("--production");

const manifest = JSON.parse(await readFile(resolve(pkgRoot, "package.json"), "utf8"));
const externalDependencies = Object.keys(manifest.dependencies ?? {}).filter((name) => !name.startsWith("@labshelf/"));

const options = {
  entryPoints: [resolve(pkgRoot, "src/extension.ts")],
  outfile: resolve(outDir, "extension.js"),
  bundle: true,
  platform: "node",
  format: "cjs",
  // Matches the Node of the Electron shipped with engines.vscode ^1.98.
  target: ["node20"],
  // `vscode` is provided by the host; `node:sqlite` is a builtin esbuild leaves alone.
  external: ["vscode", ...externalDependencies],
  minify: production,
  sourcemap: true,
  tsconfig: resolve(pkgRoot, "tsconfig.json"),
  logLevel: "info",
};

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  console.log(`[labshelf-host] watching → ${options.outfile}`);
} else {
  await rm(outDir, { recursive: true, force: true });
  await build(options);
}
