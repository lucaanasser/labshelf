Run the full pre-commit checklist in order. Stop and report if any step fails.

1. **Compile + test** — run /check. If it fails, stop here.
2. **Import validation** — use the import-validator agent to confirm zero TypeScript errors.
3. **Dead code** — use the legacy-cleaner agent to scan for newly introduced dead code (identify only, do not delete without confirmation).
4. **Comments** — use the comment-enforcer agent on every file modified in this session (check `git diff --name-only HEAD`).
5. **Specs** — use the spec-keeper agent on every module whose behavior changed in this session.
6. **Commits** — use the commit-splitter agent to stage and commit all changes as atomic commits.

Report a checklist at the end:
- [ ] Compilation clean
- [ ] Tests passing
- [ ] Imports valid
- [ ] No new dead code
- [ ] Comments enforced
- [ ] Specs updated
- [ ] Changes committed
