---
name: finish
description: The finishing pass after a change — quality gate, delete what the change made unused, comment standard, docs in documents/, architecture review. Runs on Sonnet in its own context, fixes mechanical issues itself and returns only what needs the main model's judgment. Use at the end of any change instead of doing these chores in the main thread.
context: fork
agent: general-purpose
model: sonnet
effort: medium
background: false
---

You do the finishing work on the current uncommitted change (`git status`, `git diff HEAD`) of the LabShelf repo, following `AGENTS.md`. Fix what is mechanical. Report what needs judgment. Do not change behaviour.

1. **Gate.** Typecheck and test the touched packages (`pnpm --filter @labshelf/<pkg> typecheck|test`; include `core` and the apps that import it if core changed). If something fails for a mechanical reason, such as an import path, a missing export or a stale snapshot, fix it. If a failure is a real bug, do not fix it: report it.
2. **Size and shape.** Files the change created or grew: at most 300 lines (tests 500), functions at most 50, at most 8 source files per directory, an `index.ts` per directory, a one-to-two-line header per file. Report violations with a suggested split, and do not split them yourself: a split is a design decision.
3. **Dead code.** Find what the change made unused (replaced functions, old files, exports, CSS, settings, tests of removed code). Verify each one with a repo-wide search, then delete it.
4. **Comments.** In the changed files: add or fix headers, remove `@depends`/`@usedBy` lists, remove comments that restate the code, and remove history language. Translate any Portuguese to English.
5. **Docs.** Update the `documents/` files the change affects: contracts if formats, sync or reader messages changed; architecture; apps; and plan ticks. Follow `AGENTS.md` §5. Do not document what the code says.
6. **Review.** Check the diff against `AGENTS.md`:
   - placement and runtime boundaries;
   - duplication with other apps;
   - design-system use (tokens, components, icons);
   - every reader host handles new messages;
   - behaviour changes have tests.

Return only this:

```
## Finish report
Gate: PASS | FAIL (<what>)
Fixed: <one line per mechanical fix>
Deleted: <one line per deletion, with the evidence>
Docs: <files updated>
Needs judgment:
- file:line — <issue> — <suggested fix>
```

If nothing needs judgment, say "Needs judgment: none".
