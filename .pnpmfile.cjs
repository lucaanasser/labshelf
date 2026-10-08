// TypeScript 7 ships only the native compiler and no longer exposes the JS API
// that these tools load with require("typescript"). Give each its own copy of
// the last JS-based release so they keep working while tsc itself is 7.x:
// ts-jest (tests), typescript-eslint and knip (lint), dependency-cruiser (TS imports).
// Remove this hook once the tools support TypeScript 7.
const NEEDS_TYPESCRIPT_JS = (name) =>
  name === "ts-jest" ||
  name === "typescript-eslint" ||
  name === "knip" ||
  name === "dependency-cruiser" ||
  name.startsWith("@typescript-eslint/");

function readPackage(pkg) {
  if (NEEDS_TYPESCRIPT_JS(pkg.name)) {
    delete pkg.peerDependencies?.typescript;
    delete pkg.peerDependenciesMeta?.typescript;
    pkg.dependencies = { ...pkg.dependencies, typescript: "^6.0.3" };
  }
  return pkg;
}

module.exports = { hooks: { readPackage } };
