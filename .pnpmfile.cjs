// TypeScript 7 ships only the native compiler and no longer exposes the JS API
// that ts-jest loads with require("typescript"). Give ts-jest its own copy of
// the last JS-based release so tests keep compiling while tsc itself is 7.x.
// Remove this hook once ts-jest supports TypeScript 7.
function readPackage(pkg) {
  if (pkg.name === "ts-jest") {
    delete pkg.peerDependencies?.typescript;
    pkg.dependencies = { ...pkg.dependencies, typescript: "^6.0.3" };
  }
  return pkg;
}

module.exports = { hooks: { readPackage } };
