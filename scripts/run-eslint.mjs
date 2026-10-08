// Runs ESLint on the package in the current directory from the repo root, so the shared
// eslint-suppressions.json (root-relative paths) applies, and prints how many violations
// the baseline still holds for the package. Regenerate the baseline from the root with
// `pnpm exec eslint packages --suppress-all --suppressions-location eslint-suppressions.json`.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageDir = `packages/${basename(process.cwd())}`;
const suppressionsFile = resolve(root, "eslint-suppressions.json");

// A baseline entry that no longer matches is not an error: fixing code must not break lint midway.
const run = spawnSync(
  "pnpm",
  ["exec", "eslint", "--suppressions-location", suppressionsFile, "--pass-on-unpruned-suppressions", ...process.argv.slice(2), packageDir],
  { cwd: root, stdio: "inherit" },
);

if (existsSync(suppressionsFile)) {
  const baseline = JSON.parse(readFileSync(suppressionsFile, "utf8"));
  let known = 0;
  for (const [file, rules] of Object.entries(baseline)) {
    if (!file.startsWith(`${packageDir}/`)) continue;
    for (const rule of Object.values(rules)) known += rule.count;
  }
  console.log(`eslint ${packageDir}: ${known} known size violations in the baseline`);
}
process.exit(run.status ?? 1);
