# LabShelf Implementation Rules

These rules guide any change made to this repository.

## Architecture

- Preserve the separation between `core`, `db`, `storage`, `pdf`, `bibtex`, `ui`, and `commands`.
- Do not mix file access, database access, and UI in the same flow when an appropriate layer exists for each concern.
- Prefer small, explicit services with a single responsibility.
- Any new feature must follow the existing flow of events, services, and UI before creating a parallel path.

## Required specs

- Every new feature or relevant change must have or update a file in `specs/*.spec.yaml`.
- The spec name must reflect the feature domain, for example `sidebar.spec.yaml`, `database.spec.yaml`, or `pdf.spec.yaml`.
- The spec must describe, at minimum:
  - `feature`
  - `architecture`
  - `database`
  - `events`
  - `errors`
  - `ui`
  - `tests`
  - `ai_notes`
- Keep specs consistent, specific, and verifiable. Avoid vague descriptions.
- If the implementation changes observed behavior, the corresponding spec must be updated in the same change.

## Comments and documentation

- Use comments only to explain intent, architectural decisions, or rules that are not obvious from the code.
- Prefer short module comments at the top of files when they are useful to summarize responsibilities and dependencies.
- Do not add line-by-line comments to narrate self-explanatory code.
- If a business rule or technical decision is important, document it in the spec or in the code near the decision point.

## Icons and emoji

- Using emoji in the UI, in documentation, or in agent messages is forbidden unless the user's prompt explicitly requests it.
- Always prefer minimal SVG icons from standard, professional libraries when possible, maintaining visual consistency across screens and components.
- When a text icon needs to be replaced, use a coherent set of inline SVGs or shared SVG files instead of decorative Unicode characters.

## Logs

- Record important events with structured logging.
- Errors must be logged with enough context to diagnose the cause without relying on manual debugging.
- When there is a fallback, degradation, or alternative behavior, log it explicitly.
- Avoid noisy logs on hot paths; prefer meaningful, consistent, diagnostically useful logs.
- Use the project's existing logger when possible, instead of creating parallel formats.

## Required tests

Every new feature or relevant modification **MUST** have automated tests that validate conformance with the corresponding spec.

### Testing rules

- **Minimum coverage**: 50% coverage across all layers, 80%+ on critical paths (database, file I/O, BibTeX parsing)
- **Structure**: Tests organized in `__tests__/<layer>/` mirroring the architecture in `src/<layer>/`
- **Scope**: Each spec in `specs/*.spec.yaml` must have tests covering all behaviors listed in the `tests` section
- **Execution**: `npm test` must pass locally before any commit
- **Naming**: Test files must be `<module>.test.ts` or `<feature>.spec.ts`

### What to test

1. **Unit Tests**: Every public function and class must have at least one test
2. **Integration Tests**: Interactions between modules specified in the spec
3. **Error Scenarios**: All errors listed in `errors` in the spec must be tested
4. **Fixtures**: Use consistent data in `__tests__/fixtures/`

### Change rejection

Changes will be rejected if they:
- Have no tests corresponding to the feature
- Break existing tests
- Reduce coverage without documented justification
- Do not update tests when the spec changes

## Implementation quality

- Before finalizing a change, verify whether there are tests, validation, or compilation steps applicable to the modified code.
- Do not deliver new behavior without updating the corresponding spec.
- Do not submit code without tests that validate the associated spec.
- If the change introduces new responsibility, also review the repository documentation when it makes sense.
