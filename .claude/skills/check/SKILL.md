---
name: check
description: Quality gate for the packages touched by the current change — typecheck, tests, lint, size/shape limits — run on Haiku in its own context; returns PASS/FAIL with only the errors that matter, so long logs never reach the main model.
context: fork
agent: general-purpose
model: haiku
effort: low
background: false
---

Run the gate on the current uncommitted change of the LabShelf repo and summarize it.

1. Find the touched packages from `git status --porcelain` (the `packages/<pkg>/` prefixes). If `packages/core` changed, also include every app that imports `@labshelf/core`.
2. For each package, run: `pnpm --filter @labshelf/<pkg> typecheck`, then `pnpm --filter @labshelf/<pkg> test`, then `lint` if the package defines it.
3. Run `wc -l` on the touched files. Flag source files over 300 lines and tests over 500 that this change created or grew (compare with `git show HEAD:<file> | wc -l`).
4. Flag directories that gained a file and now hold more than 8 source files, not counting `index.ts`.

Return only:

```
Gate: PASS | FAIL
<pkg>: typecheck PASS|FAIL · tests PASS|FAIL (n passed, m failed) · lint PASS|FAIL|n/a
Errors (max 15, most relevant first):
- file:line — message
Limits:
- <violations, or "none">
```

Do not include passing test names or full logs, and do not try to fix anything.
