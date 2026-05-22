/**
 * Barrel re-export for IO services (PDF pipeline, BibTeX generator).
 *
 * @depends io/pdf, io/bibtex
 * @dependents @labshelf/core index, downstream packages
 */
export * from "./pdf/index.js";
export * from "./bibtex/index.js";
