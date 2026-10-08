// Runs knip in warning mode (never fails on findings) and prints one count per category.
// `pnpm exec knip` prints the full list.
import { spawnSync } from "node:child_process";

const run = spawnSync("pnpm", ["exec", "knip", "--no-exit-code", "--reporter", "json"], {
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});
let issues;
try {
  ({ issues } = JSON.parse(run.stdout));
} catch (error) {
  console.error(`knip did not produce a report: ${error.message}\n${run.stderr}`);
  process.exit(1);
}

const totals = {};
for (const issue of issues) {
  for (const [category, findings] of Object.entries(issue)) {
    if (Array.isArray(findings) && findings.length > 0) totals[category] = (totals[category] ?? 0) + findings.length;
  }
}
const sum = Object.values(totals).reduce((a, b) => a + b, 0);
const detail = Object.entries(totals).map(([category, count]) => `${category} ${count}`).join(", ");
console.log(`knip: ${sum} findings (warning mode)${detail ? `: ${detail}` : ""}. List: pnpm exec knip`);
