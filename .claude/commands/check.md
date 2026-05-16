Run the full quality gate for packages/vscode:

1. TypeScript compilation: `cd /home/luca/labshelf && pnpm --filter vscode exec tsc --noEmit`
2. Tests: `pnpm --filter vscode test --passWithNoTests`

Report results as:
- PASS or FAIL for each step
- For failures: exact error messages with file:line references
- Final verdict: "Ready to commit" or "Needs fixes" with a bullet list of what to address
