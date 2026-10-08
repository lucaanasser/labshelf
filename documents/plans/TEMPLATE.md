# Plan: <title>

Status: draft | approved | in progress (session <n> of <m>) | done
Size: P | M | G | GG — <one line: why this size>; grows to <next size> if <condition>
Pending decisions: <n>

<!--
How to use this template:
- Copy it to documents/plans/<slug>.plan.md and replace every <…>.
- Every item has an id (D1, A1, S1, R1). Approve, reject or comment item by item by id.
- An executor reads §1, §2, its session in §6 and only the step blocks of that session. Write every block so that this is enough.
- Keep each section as short as it can be. Leave out what the code or documents/ already say, and link instead.
- Delete these comments in the real plan.

Size, in AI work sessions (one session is one conversation, with context still manageable):
  P  one package, a few files ................ minutes, part of a session
  M  core + one app, with tests ............. about one session
  G  core + 2–3 apps, or a new UI surface .... 1–3 sessions
  GG new subsystem or contract change ........ several sessions, the first one a spike
Between two sizes, pick the smaller and write what would make it grow. Check
documents/plans/CALIBRATION.md for how past estimates compared with reality.
-->

## 1. Goal

<Two or three sentences: what the user gets and why it matters. No implementation detail.>

## 2. Decisions

The choices this plan rests on. Each one is a line the user can approve on its own.

- [ ] **D1** <decision> — <why, in one clause>
- [ ] **D2** <decision> — <why>

Open (blocks approval):

- **Q1** <question> — options: <a> / <b>; recommendation: <a, because …>

## 3. Scope

- **In:** <apps, surfaces, behaviours>
- **Out:** <what this plan deliberately does not do>
- **Contracts touched:** <documents/contracts/… or "none">

## 4. Acceptance criteria

Each criterion is observable: a user action and its result, or a command and its output.

- [ ] **A1** <criterion>
- [ ] **A2** <criterion>

## 5. Design

Only what an executor cannot infer: placement (core vs app), new data shapes or formats, the UI sketch, and the algorithm in outline. Use a table or a short list, not prose.

| Piece | Lives in | Notes |
|---|---|---|
| <logic> | `core/src/<domain>/` | <…> |
| <glue> | `packages/<app>/src/…` | <…> |

## 6. Sessions and steps

<!--
Size P or M: one session. Keep the single "Session 1" block and drop the handoff line.
Size G or GG: one block per session. A session ends at a point where:
  - typecheck and tests pass;
  - the work is committed;
  - the next session needs nothing from this conversation except the plan file.
Splitting keeps each conversation's context small, which is cheaper and gives better results.
-->

### Session 1 — <deliverable in a few words>

- **Starts from:** <state the repo must be in, e.g. "clean tree on branch X">
- **Ends with:** <what exists and passes at the end, A-ids>
- **Commit:** yes, at the end of the session

| Id | Step | Depends on | Runner | Done when | OK |
|---|---|---|---|---|---|
| S1 | <one line> | — | H · main thread | A1 | [ ] |
| S2 | <one line> | S1 | M · implementer (sonnet) | A2 | [ ] |
| S3 | Finish: gate, docs, review | S1–S2 | `finish` skill | gate passes | [ ] |

### Session 2 — <deliverable>

- **Starts from:** session 1 committed
- **Ends with:** <…>
- **Commit:** yes

| Id | Step | Depends on | Runner | Done when | OK |
|---|---|---|---|---|---|
| S4 | <…> | S2 | <…> | <…> | [ ] |

Runner tiers:

- **H**: the session model (Opus or Fable). Use it for design, algorithms and judgment.
- **M**: Sonnet. Use it for well-specified implementation, moves and tests.
- **L**: Haiku. Use it for gates, import fixes and commits.

### Step blocks

#### S1 — <step title>

- **Do:** <what to build or change, in two to five bullets>
- **Touch:** <files or folders>. **Do not touch:** <files or folders>
- **Context:** <the facts the runner needs, from scouts or the brainstorm; link to the docs>
- **Done when:** <the A-ids, plus any step-specific check>

#### S2 — <step title>

…

## 7. Risks

- **R1** <what could go wrong> — <mitigation>

## 8. Log

<!-- One line per finished step or session: date and time, what was done, anything that deviated from the plan. The next session reads this. -->
