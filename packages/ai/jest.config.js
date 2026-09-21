module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  // TypeScript 7 ships only the native compiler, without the JS API ts-jest
  // needs, so tests compile with the aliased TypeScript 6 package instead.
  // See also .pnpmfile.cjs, which covers ts-jest's own require("typescript").
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { compiler: "typescript-js" }],
  },
  roots: ["<rootDir>/__tests__"],
  testMatch: ["**/__tests__/**/*.test.ts"],
  moduleFileExtensions: ["ts", "js", "json"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  testTimeout: 30000,
};
