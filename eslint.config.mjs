// Size limits from AGENTS.md section 3. Existing violations are baselined in
// eslint-suppressions.json (see scripts/run-eslint.mjs), so only new ones fail.
import tseslint from "typescript-eslint";

const sourceLimits = {
  "max-lines": ["error", { max: 300, skipBlankLines: false, skipComments: false }],
  "max-lines-per-function": ["error", { max: 50, skipBlankLines: false, skipComments: false }],
};

const testLimits = {
  "max-lines": ["error", { max: 500, skipBlankLines: false, skipComments: false }],
  // A describe() callback wraps a whole suite, so the per-function limit does not apply to tests.
  "max-lines-per-function": "off",
};

export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/out/**",
      "**/coverage/**",
      "**/.vscode-test/**",
      "**/media/**",
      "test-workspace/**",
      "packages/vscode/__mocks__/**",
    ],
  },
  {
    files: ["**/*.ts"],
    languageOptions: { parser: tseslint.parser },
    // Registered without rules so existing "eslint-disable @typescript-eslint/..." comments resolve.
    plugins: { "@typescript-eslint": tseslint.plugin },
    linterOptions: { reportUnusedDisableDirectives: "off" },
    rules: sourceLimits,
  },
  { files: ["**/*.mjs", "**/*.cjs", "**/*.js"], linterOptions: { reportUnusedDisableDirectives: "off" } },
  { files: ["**/__tests__/**/*.ts"], rules: testLimits },
];
