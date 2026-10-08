// Architecture rules from AGENTS.md section 1 and 3 (acceptance criterion A2).
// Violations that exist today are recorded in .dependency-cruiser-known-violations.json
// (regenerate with `pnpm run lint:deps:baseline`); anything else fails the run.
const { readdirSync } = require("node:fs");
const { join } = require("node:path");

const APPS = "vscode|browser|terminal";
const BUILTINS = ["core"];

// One rule per directory: files outside a directory reach it only through its index.ts.
// Tests are exempt (they exercise internals) and so are imports between packages, which
// are governed by each package's `exports` map.
function directoriesUnder(dir) {
  const found = [dir];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) found.push(...directoriesUnder(join(dir, entry.name)));
  }
  return found;
}

function indexOnlyRules() {
  const rules = [];
  for (const pkg of readdirSync("packages")) {
    let dirs;
    try {
      dirs = directoriesUnder(`packages/${pkg}/src`);
    } catch {
      continue;
    }
    for (const dir of dirs) {
      rules.push({
        name: "no-import-past-index",
        comment: `Code outside ${dir} imports its index.ts, never an internal file.`,
        severity: "error",
        from: { path: `^packages/${pkg}/`, pathNot: [`^${dir}/`, "/__tests__/"] },
        to: { path: `^${dir}/[^/]+$`, pathNot: `^${dir}/index\\.tsx?$` },
      });
    }
  }
  return rules;
}

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-app-to-app",
      comment: "Apps import only core and third-party packages, never each other.",
      severity: "error",
      from: { path: `^packages/(${APPS})/` },
      to: { path: `^packages/(${APPS})/`, pathNot: "^packages/$1/" },
    },
    {
      name: "no-core-to-app",
      comment: "Core never depends on an app.",
      severity: "error",
      from: { path: "^packages/core/" },
      to: { path: `^packages/(${APPS})/` },
    },
    {
      name: "neutral-core-no-runtime-folders",
      comment: "Runtime-neutral core code does not import node/ or dom/ folders.",
      severity: "error",
      from: { path: "^packages/core/src/", pathNot: ["/(node|dom)/", "/__tests__/"] },
      to: { path: ["^packages/core/src/(node|dom)/", "^packages/core/src/.*/(node|dom)/"] },
    },
    {
      name: "neutral-core-no-node-builtins",
      comment: "Runtime-neutral core code does not use node:* or Node built-in modules.",
      severity: "error",
      from: { path: "^packages/core/src/", pathNot: ["/(node|dom)/", "/__tests__/"] },
      to: { dependencyTypes: BUILTINS },
    },
    ...indexOnlyRules(),
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    // Built output of workspace packages is not source; node_modules stays in the graph
    // (not followed) so Node built-ins and third-party imports can be matched by rules.
    exclude: { path: "^packages/[^/]+/(dist|out)/" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.base.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
      extensions: [".ts", ".tsx", ".js", ".mjs", ".cjs", ".json"],
    },
  },
};
