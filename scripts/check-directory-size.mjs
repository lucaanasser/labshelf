// Fails when a directory under packages/*/src holds more than 8 source files directly
// (AGENTS.md section 3), unless scripts/directory-size-baseline.json already records it
// with at least that many. `--update` rewrites the baseline with the current offenders.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const LIMIT = 8;
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const baselineFile = join(root, "scripts", "directory-size-baseline.json");
const baseline = existsSync(baselineFile) ? JSON.parse(readFileSync(baselineFile, "utf8")) : {};

const isSourceFile = (name) => /\.(ts|tsx|css)$/.test(name) && name !== "index.ts" && !name.endsWith(".d.ts");

function collectOffenders(dir, offenders) {
  const entries = readdirSync(dir, { withFileTypes: true });
  const count = entries.filter((entry) => entry.isFile() && isSourceFile(entry.name)).length;
  if (count > LIMIT) offenders[relative(root, dir)] = count;
  for (const entry of entries) {
    if (entry.isDirectory()) collectOffenders(join(dir, entry.name), offenders);
  }
}

const offenders = {};
for (const pkg of readdirSync(join(root, "packages"))) {
  const src = join(root, "packages", pkg, "src");
  if (existsSync(src)) collectOffenders(src, offenders);
}

if (process.argv.includes("--update")) {
  writeFileSync(baselineFile, `${JSON.stringify(offenders, null, 2)}\n`);
  console.log(`directory baseline written: ${Object.keys(offenders).length} directories`);
  process.exit(0);
}

const grown = Object.entries(offenders).filter(([dir, count]) => count > (baseline[dir] ?? LIMIT));
for (const [dir, count] of grown) {
  console.error(`${dir} holds ${count} source files (limit ${LIMIT}, baseline ${baseline[dir] ?? "none"}). Group them into subfolders.`);
}
const known = Object.keys(offenders).length - grown.length;
console.log(`directory size: ${known} known directories over ${LIMIT} files, ${grown.length} new or grown`);
process.exit(grown.length > 0 ? 1 : 0);
