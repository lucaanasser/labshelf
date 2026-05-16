# LabShelf Documentation

This folder is organized to explain the codebase in natural language, by layer and by concern.

## Structure

- `architecture/` — how the system is wired together and how data flows through it
- `reference/` — module-by-module explanations of the main source folders
- `rules/` — architectural and general coding rules to preserve while changing the codebase
- `flows/` — end-to-end behavior descriptions for the main user journeys
- `plans/` — implementation plans and task breakdowns
- `specs/` — feature specs that define expected behavior in a testable way

## Reading order

1. `architecture/overview.md`
2. `rules/architecture.md`
3. `reference/directories.md`
4. `reference/modules.md`
5. `flows/import-and-library.md`
6. The relevant `specs/*.spec.yaml` file for the feature being changed

## Goal

The documentation in this folder is written to help a developer understand:

- what each directory is for
- which services own which responsibilities
- how UI, commands, storage, database, and PDF ingestion fit together
- which rules should not be broken during implementation
- which functions are the main entry points for each behavior
