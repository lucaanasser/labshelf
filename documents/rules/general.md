# General Rules

## Writing code

- Use clear names that describe responsibility.
- Prefer small functions that are easy to read in one pass.
- Keep comments short and only use them when the intent is not obvious.
- Use structured logging for important actions and failures.

## Writing docs

- Explain the system in natural language first, then list the code entry points.
- Prefer concrete examples over abstract descriptions.
- Describe what the code does, what depends on it, and what should not change.
- Keep docs organized by feature and by layer, not by random file order.

## Working in this repo

- Every meaningful behavior change should be reflected in a spec.
- Every user-facing flow should have a manual verification note.
- When a module owns a behavior, document the main functions that control it.
