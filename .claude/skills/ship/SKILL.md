---
name: ship
description: Close out the current change — the finish pass (Sonnet), then atomic commits (Haiku). Stops if the finish pass reports a failing gate or issues that need judgment.
---

1. Run the `finish` skill.
2. If its report says `Gate: FAIL` or lists anything under "Needs judgment", stop. Show the report to the user, or fix the items yourself if they are part of the task you were given, then run step 1 again.
3. Run the `commit-splitter` agent. It runs on Haiku and asks before committing.
4. Report the commits created.
