// Compiles core once per runtime (neutral, node, dom) and fails when a config reports more
// errors than packages/core/runtime-baseline.json allows. Run from packages/core;
// `--update` rewrites the baseline with the current counts.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const baselineFile = "runtime-baseline.json";
const baseline = existsSync(baselineFile) ? JSON.parse(readFileSync(baselineFile, "utf8")) : {};

function hasRuntimeFolder(dir, name) {
  return readdirSync(dir, { withFileTypes: true }).some(
    (entry) => entry.isDirectory() && (entry.name === name || hasRuntimeFolder(join(dir, entry.name), name)),
  );
}

// The node and dom configs add nothing over the neutral one until a node/ or dom/ folder exists.
const configs = ["neutral", "node", "dom"].filter((name) => name === "neutral" || hasRuntimeFolder("src", name));

const counts = {};
for (const name of configs) {
  const run = spawnSync("pnpm", ["exec", "tsc", "-p", `tsconfig.${name}.json`], { encoding: "utf8" });
  const output = `${run.stdout}${run.stderr}`;
  counts[name] = output.split("\n").filter((line) => line.includes("error TS")).length;
  if (counts[name] > (baseline[name] ?? 0)) process.stdout.write(output);
}

if (process.argv.includes("--update")) {
  writeFileSync(baselineFile, `${JSON.stringify(counts, null, 2)}\n`);
  console.log(`runtime baseline written: ${JSON.stringify(counts)}`);
  process.exit(0);
}

let failed = false;
for (const [name, count] of Object.entries(counts)) {
  const allowed = baseline[name] ?? 0;
  const status = count > allowed ? "FAIL: new errors" : count < allowed ? "ok, baseline can drop (--update)" : "ok";
  console.log(`runtime ${name}: ${count} errors, ${allowed} known (${status})`);
  if (count > allowed) failed = true;
}
process.exit(failed ? 1 : 0);
