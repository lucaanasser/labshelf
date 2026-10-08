# LabShelf

A local-first research paper manager. Your library is an ordinary folder of PDFs and text files that you own. LabShelf imports papers, extracts and resolves their metadata, keeps BibTeX in step, lets you read and annotate PDFs, and optionally syncs everything through Google Drive.

It ships as three apps of one product:

- **VS Code extension:** library tree, paper list and detail pane, PDF reader, import with OCR, AI indexing.
- **Browser extension** (Chrome, Firefox): capture papers from any page or from Google Scholar, read them with the same reader, browse the library.
- **Terminal app** (`labshelf`): a keyboard-driven explorer and scriptable CLI over the same library.

## Quick start

```bash
pnpm install
pnpm -r typecheck && pnpm -r test
```

Building and running each app, plus OAuth setup for Drive, are covered in [documents/apps/](documents/apps/README.md).

## Repository

```
packages/core/       shared code: domain, formats, sync, PDF pipeline, reader, design system
packages/vscode/     VS Code extension
packages/browser/    browser extension
packages/terminal/   terminal app
documents/           architecture, contracts between apps, setup, plans
```

Start with [documents/README.md](documents/README.md). Rules for contributors and coding agents are in [AGENTS.md](AGENTS.md).
