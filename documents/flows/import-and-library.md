# Import and Library Flow

This page explains the main paper ingestion flow in plain language.

## Single import

1. The user selects a PDF.
2. The command hands the file to `PaperService.addPaperFromUri()`.
3. The parser reads metadata from the PDF.
4. The service creates a paper folder in the workspace.
5. The original PDF is copied into that folder as `paper.pdf`.
6. The paper record is saved in the database.
7. BibTeX and metadata artifacts are written.
8. An event is emitted so the UI can refresh.

## List refresh

- The collections tree listens for paper events and updates its counts.
- The list panel listens for paper events and reloads the current collection.
- Commands stay separate from rendering so the UI remains simple.

## Future batch behavior

The batch import plan is to reuse the same single-file flow for every PDF in a folder. The folder itself is only a container; each PDF becomes one paper record.
