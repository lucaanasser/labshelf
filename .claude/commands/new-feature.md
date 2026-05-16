Workflow for creating a new feature. The feature name or description is provided as the argument to this command.

Follow these steps in order — do not skip ahead to implementation:

1. **Spec first** — use the spec-keeper agent to create a new spec for this feature in documents/specs/. The spec must be complete enough to implement from before any code is written. Show the spec and wait for approval.

2. **Implementation** — implement the feature following the approved spec. Reference the spec throughout. Do not add behavior not described in the spec without updating the spec first.

3. **Comments** — use the comment-enforcer agent on all new and modified files.

4. **Tests** — use the test-writer agent to write tests covering the spec's happy path, edge cases, and expected failures.

5. **Validation** — run /check to confirm compilation and tests pass.

6. **Spec review** — use the spec-keeper agent to verify the implementation matches the spec. Update the spec if any detail changed during implementation.

7. **Commit** — use the commit-splitter agent to create atomic commits.

All code, comments, specs, and commit messages must be in English.
