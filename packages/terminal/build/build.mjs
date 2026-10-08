/**
 * Bundles @labshelf/terminal into dist/labshelf.mjs (the `labshelf` command) and dist/thumbnailWorker.mjs.
 * @labshelf/core and @labshelf/reader are bundled from source; pdfjs-dist and the native canvas stay external and are
 * loaded from node_modules at run time, only when a PDF is parsed or rendered.
 *
 * Google OAuth credentials: src/sync/googleDriveCredentials.ts is gitignored. When it is missing, the VS Code
 * extension's copy is used (the terminal must share its OAuth client, see the .example file), and failing that the
 * placeholder template, which builds an app whose sync asks for LABSHELF_GOOGLE_CLIENT_ID/SECRET.
 *
 * @depends esbuild
 * @dependents pnpm --filter @labshelf/terminal build
 */
import { build, context } from "esbuild";
import { chmod, copyFile, access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const repo = resolve(root, "../..");
const watch = process.argv.includes("--watch");

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function ensureCredentials() {
  const target = resolve(root, "src/sync/googleDriveCredentials.ts");
  if (await exists(target)) return;
  const fromVscode = resolve(repo, "packages/vscode/src/sync/auth/googleDriveCredentials.ts");
  const template = resolve(root, "src/sync/googleDriveCredentials.example.ts");
  const source = (await exists(fromVscode)) ? fromVscode : template;
  await copyFile(source, target);
  console.log(`[labshelf-terminal] OAuth credentials: copied ${source === fromVscode ? "the VS Code extension's client" : "the placeholder template"}`);
}

const banner = [
  "#!/usr/bin/env node",
  "import { createRequire as __labshelfCreateRequire } from 'node:module';",
  "const require = __labshelfCreateRequire(import.meta.url);",
].join("\n");

const common = {
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: true,
  logLevel: "info",
  // Loaded lazily from node_modules: pdfjs reads its data files next to itself, the canvas is a native module.
  external: ["pdfjs-dist", "pdfjs-dist/*", "@napi-rs/canvas"],
  banner: { js: banner },
};

await ensureCredentials();

const entries = [
  { ...common, entryPoints: [resolve(root, "src/main.ts")], outfile: resolve(root, "dist/labshelf.mjs") },
  { ...common, entryPoints: [resolve(root, "src/preview/thumbnailWorker.ts")], outfile: resolve(root, "dist/thumbnailWorker.mjs"), banner: { js: banner.split("\n").slice(1).join("\n") } },
];

if (watch) {
  for (const options of entries) {
    const ctx = await context(options);
    await ctx.watch();
  }
  console.log("[labshelf-terminal] watching…");
} else {
  await Promise.all(entries.map((options) => build(options)));
  await chmod(resolve(root, "dist/labshelf.mjs"), 0o755);
  console.log("[labshelf-terminal] built dist/labshelf.mjs");
}
