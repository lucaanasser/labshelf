# Import and Library Flow

This page explains the main paper ingestion flow in plain language.

## Single import

1. The user selects a PDF, or drops one onto the library tree.
2. The command hands the file to `PaperService.addPaperFromUri()`, optionally with the folder it was dropped on.
3. `PdfImportParser` reads metadata from the PDF. When the text layer is missing or unreadable, the OCR engine reads the page images instead.
4. Fields still missing are looked up by DOI or arXiv id against CrossRef and arXiv.
5. The service creates a paper folder named after the cite key, under the target folder in `papers/`.
6. The original PDF is copied into that folder as `paper.pdf`.
7. The paper record is saved in the database.
8. `bib.bib` and `metadata.yaml` are written into the paper folder.
9. A `paper:added` event is emitted so the UI can refresh.

When `labshelf.ocr.makeSearchable` is on and the PDF turned out to be a scan, a background job then adds an invisible text layer so the file can be searched and selected.

## Batch import

Selecting several PDFs, or a folder, goes through `PaperService.addPapersFromUris()`. A folder is expanded to the PDFs inside it; each PDF becomes one paper record and is imported through the same single-file flow. Failures are collected per file rather than aborting the batch, and the caller reports how many succeeded and failed.

## List refresh

- The library tree listens for paper events and updates its folder counts, coalescing bursts so a folder move triggers one refresh rather than one per paper.
- The list panel listens for paper events and reloads the folder it is showing.
- Commands stay separate from rendering so the UI remains simple.
