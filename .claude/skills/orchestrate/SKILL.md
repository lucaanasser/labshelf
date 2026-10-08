---
name: orchestrate
description: Turn a large or loosely worded request (a feature, a redesign, a refactor, "implement X with Y and Z") into a structured plan of work packages, each assigned to the right model and agent, then run it — scouts gather context, the heavy model does only the hard parts, cheaper models do docs, checks and commits. Use for any task that spans several files or packages, or when the user asks to plan, split or delegate work.
argument-hint: <what you want built or changed>
---

You are the orchestrator, running on the model the user picked. Spend that model on judgment: understanding the request, design decisions, hard code. Delegate reading, mechanical work, docs, checks and commits.

Request: $ARGUMENTS

If the request is a path to an existing plan (`documents/plans/<slug>.plan.md`, optionally followed by `session <n>`), skip steps 1–3 and follow **Running a plan file** below.

## 1. Brief (you, short)

Rewrite the request as a brief:
- **Goal**: what the user gets, in one or two sentences.
- **Scope**: which apps (VS Code, browser, terminal) and which visible surfaces.
- **Acceptance criteria**: observable checks, one per line.
- **Non-goals**: what is explicitly out.
- **Open questions**: only those whose answer changes the design. Ask them now with AskUserQuestion, bundled in one call. Do not ask what the code or the docs can answer.

## 2. Scout (cheap, parallel)

Do not read the codebase broadly yourself. Launch one `Explore` scout per area in a single message (they run on Sonnet). For a single narrow lookup, pass `model: "haiku"`. Typical areas:
- the core domain the feature belongs to;
- each app's current glue for it;
- the UI and design-system pieces it would use;
- the contracts it touches.

Read the briefs. Open a file yourself only when a decision depends on its exact code.

## 3. Plan (you)

Split the work into packages. Each package states:
- **Id and goal**: one sentence.
- **Files**: the files it creates or changes, and what it must not touch.
- **Depends on**: other package ids.
- **Tier and runner**: see the table below.
- **Acceptance**: the checks that prove it is done.

| Tier | Work | Runner |
|---|---|---|
| H | design decisions, new UI design, algorithms, cross-package refactors that need judgment, hard debugging | you, in this thread; or `implementer` with `model: "opus"` or `"fable"` when it can run in parallel, or when the user assigned a model to it |
| M | well-specified implementation, moves and splits from a map, tests, reviews | `implementer` / `module-splitter` / `test-writer` / `code-mapper` on Sonnet |
| L | running gates, import fixes, commits, changelog | `check` skill, `import-validator`, `commit-splitter` on Haiku |
| Docs | `documents/` updates, comment standard, dead code | the `finish` skill on Sonnet, once at the end |

Rules for the plan:
- If the user named models ("Fable does the visual"), follow them.
- Packages that touch the same files run in sequence. Only packages with disjoint files run in parallel.
- Shared logic lands in core first; app packages depend on it.
- Size the plan with the scale in `documents/plans/TEMPLATE.md` (P, M, G, GG in AI sessions). Read `documents/plans/CALIBRATION.md` first and correct for its bias. Between two sizes, pick the smaller and write what would make it grow.
- If the plan is G or GG, or has more than about five packages, write it to `documents/plans/<slug>.plan.md` from the template, split into sessions. Then stop after approval and tell the user to start session 1 with the prompt from the handoff format below, in a fresh conversation. Otherwise, keep the plan in the conversation in the same shape, shortened, and run it here.
- Show the plan to the user and wait for approval before executing, unless they said to go ahead.

## 4. Execute

- Do the tier-H packages that need this conversation's context yourself.
- Launch delegated packages with the Agent tool. Their prompts must be **self-contained**: goal, the relevant brief excerpts, files, what not to touch, acceptance checks. Agents do not see this conversation.
- Launch independent packages in one message so they run in parallel.
- After each package, run the `check` skill (Haiku) instead of reading test output yourself.
- If a package's report shows a design problem, fix the plan. Do not patch around it.

## 5. Finish and commit

- Run the `finish` skill once at the end (Sonnet). It handles dead code, comments, docs and the architecture review, and fixes the mechanical issues itself. Fix only the findings that need judgment.
- If the change is UI, extension host or terminal behaviour, run the `verify` skill and look at the screenshots it lists.
- Commit only if the user asks: `commit-splitter` (Haiku).
- If a plan file exists, tick its steps and add one line per step to its §8 log.

Report to the user: what was built, the acceptance criteria with pass/fail, what each model did, and anything left open.

## Running a plan file

1. Read §1, §2 and the header (status, size). If any decision is unchecked or any Q is open, ask about it before anything else.
2. Pick the session: the one named in the request, or the first with unticked steps. Check its **Starts from** against the session context, which gives the branch and uncommitted work. If the repo is not in that state, stop and say what differs.
3. Read only that session's table and its step blocks. Run them as in steps 4–5 above, and run nothing from later sessions. Set the status to `in progress (session <n> of <m>)`.
4. End the session:
   - run the `finish` skill;
   - tick the steps and the acceptance criteria they meet;
   - add §8 log lines with date and time;
   - commit if the session says **Commit: yes**. Approving the plan authorises those commits; use `commit-splitter`.
5. If it was the last session:
   - set the status to `done`;
   - add a row to `documents/plans/CALIBRATION.md` with the estimated size and sessions, the sessions used, the real time from the first log line to the last, the real size, and why they differed;
   - update its bias line;
   - delete the plan, or archive it only if it meets `documents/archive/README.md`.
6. Reply with the handoff message below and stop. Never start the next session in this conversation; a fresh context is the point of splitting.

Handoff message (in the user's language):

```
## Session <n> of <m> done — <plan title>
Done: S<a>–S<b> · acceptance A<x>, A<y> pass
Deviations: <one line each, or "none"> (also in the plan's §8 log)
Commit: <short hash and message, or "not committed: why">
Estimate: session planned as <…>, took <time>

Next session: paste this into a new conversation:
/orchestrate documents/plans/<slug>.plan.md session <n+1>
```

On the last session, replace the "Next session" part with a three-line summary of what the user now has, and the calibration row you added.
