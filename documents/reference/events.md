# Event Reference

This page documents the main domain events used by LabShelf.

## `paper:added`

Emitted when a new paper is imported and stored.

## `paper:updated`

Emitted when a paper status or metadata changes.

## `paper:deleted`

Emitted when a paper is removed from the library.

## How events are used

- The collections tree uses events to refresh counts.
- The list panel uses events to reload its current view.
- The logger subscribes to events for audit-friendly messages.
