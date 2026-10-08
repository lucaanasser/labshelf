---
name: refactor-step
description: Run one session of documents/plans/architecture-refactor.plan.md (or one named step) with the cheapest capable models — Sonnet maps and moves, the main model decides only behavior differences and design-heavy splits, Sonnet finishes; ends with the session handoff message. Use when the user asks to continue or advance the refactor.
argument-hint: [session <n> | step id, e.g. S3.2]
---

Target: $ARGUMENTS. If empty, use the first session with unticked steps.

1. Read §1, §2 and the header of `documents/plans/architecture-refactor.plan.md`, then only the target session's table and its step blocks.
   - If an unchecked decision or an open Q blocks one of these steps, ask about it first. Each Q names the steps it blocks.
2. Check the session's **Starts from** against the session context, which gives the branch and uncommitted work. If the tree is not clean, stop and ask: every step is its own commit.
3. For each step, in order:
   1. **Map it.** Run `code-mapper` (Sonnet) on the code the step touches, and read its plan rather than the code. Under "Merges", each behaviour difference between copies is a decision. Take it yourself, or ask the user when it is a product choice; never let a cheaper model choose silently. A difference that is not in the plan's D7 list is a new behaviour change: ask the user.
   2. **Execute it** by its Runner:
      - moves, merges and splits that follow the map go to `module-splitter`;
      - deletions go to `dead-code-cleaner`;
      - steps marked **H**, and splits that need real design, you do yourself or give to an `implementer`.
   3. **Close it.** Run the `check` skill. Tick the step, add a §8 log line with date and time, and commit it with `commit-splitter`: approving the plan authorises one commit per step.
4. At the end of the session:
   - run the `finish` skill once;
   - tick the acceptance criteria the session met;
   - set the status to `in progress (session <n> of 13)`.
5. Reply with the handoff message from the `orchestrate` skill, with "Next session" set to `/refactor-step session <n+1>`. Then stop; the next session runs in a fresh conversation.
