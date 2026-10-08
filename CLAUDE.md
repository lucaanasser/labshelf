@AGENTS.md

## Claude Code in this repo

Talk to the user in the language they write in. Everything committed to the repo is in English.

### Division of labour between models

The model the user picked for the session (often Opus or Fable) is the expensive one. Spend it on understanding the request, design decisions and hard code. Hand everything else to cheaper agents:

| Work | Who | Model |
|---|---|---|
| reading the codebase to understand the current state | `Explore` scouts, several in parallel, returning briefs | Sonnet (Haiku for narrow lookups) |
| planning a large request into work packages | `orchestrate` skill, run by you | yours |
| design, algorithms, new UI, judgment-heavy refactors | you, or `implementer` with `model: "opus"` or `"fable"` for parallel packages | Opus / Fable |
| well-specified implementation, moves and splits, tests | `implementer`, `module-splitter`, `test-writer`, `code-mapper` | Sonnet |
| typecheck, tests, limits | `check` skill (forked; returns only errors) | Haiku |
| dead code, comments, docs, architecture review | `finish` skill (forked; fixes mechanical issues, returns what needs judgment) | Sonnet |
| commits, changelog, import fixes | `commit-splitter`, `changelog-writer`, `import-validator` | Haiku |

Rules:

- For any request to build or change something that spans several files or packages, start with the `orchestrate` skill. When the user is exploring an idea or asking your opinion, use `brainstorm`: no files and no plan until they approve.
- Do not sweep the codebase yourself. Launch `Explore` scouts and read their briefs; open a file only when a decision depends on its exact code.
- Do not read test logs or run check loops yourself. Use `check`.
- Do not update `documents/`, do not apply the comment standard, and do not hunt dead code in the main thread. Run `finish` once at the end. It replaces the "Before finishing a change" steps in AGENTS.md §7.
- Agents do not see this conversation. Every delegated prompt must be self-contained: goal, the relevant brief, the files, what not to touch, acceptance checks.
- If the user assigns a model to part of the work, follow it.

### Hooks

At session start (and after `/clear` or compaction), `.claude/hooks/session-context.sh` adds a few lines of context: the branch, uncommitted work by area, and the active plans with their open items and next step. Use them; do not re-derive them by reading files.

After every Edit/Write, `.claude/hooks/check-rules.sh` reports regressions against AGENTS.md: a file over its line limit, a directory over 8 source files, or history language and `@depends`/`@usedBy` lists in comments or docs. It runs outside the model and costs nothing until it fires. When it fires, fix the issue in the same change. It compares against `HEAD`, so uncommitted or untracked files count as new.

### Skills and agents

Skills: `brainstorm` (think an idea through with the user; no files touched until approved; ends in a plan from `documents/plans/TEMPLATE.md`), `orchestrate` (also runs an approved plan: `/orchestrate documents/plans/<slug>.plan.md`), `finish`, `check`, `ship` (finish + commits), `verify` (run an app for real), `refactor-step` (advance the architecture refactor plan), `health` (repo-wide audit).

Agents: `Explore`, `implementer`, `code-mapper`, `module-splitter`, `import-validator`, `dead-code-cleaner`, `comment-enforcer`, `doc-keeper`, `architecture-reviewer`, `test-writer`, `bug-tracer`, `commit-splitter`, `changelog-writer`. Each agent's model is set in its frontmatter. Agents without a model run on Sonnet (`CLAUDE_CODE_SUBAGENT_MODEL` in `.claude/settings.json`).

### Plugins (project scope)

| Plugin | Adds |
|---|---|
| `typescript-lsp` | go-to-definition and references (needs `typescript-language-server` on PATH) |
| `playwright` | browser automation for the webview and browser-extension checks |
| `context7` | current docs for pdf.js, MV3, the VS Code API |
| `pr-review-toolkit` | `/review-pr` and its review agents |
| `code-simplifier` | simplification pass |
| `hookify` | create more hooks from a conversation |
| `frontend-design` | UI design skill, also for the website |

Plugin agents set their own models: `code-simplifier` and `pr-review-toolkit`'s `code-reviewer` run on Opus, and the other review agents inherit yours. Launch them with `model: "sonnet"` unless the review really needs more.
