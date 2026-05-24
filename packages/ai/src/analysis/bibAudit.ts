/**
 * F26 — Bibliography audit. Parses .tex and .bib content with regex (LaTeX is
 * not parsed completely — only the citation/bib-entry patterns we care about)
 * and reconciles the keys. Output drives diagnostics + status bar UI.
 *
 * @depends none
 * @dependents vscode BibAuditProvider
 */

const CITE_RE = /\\(?:cite[a-zA-Z]*|citep|citet|citealp|parencite|textcite)\{([^}]+)\}/g;
const BIB_ENTRY_RE = /@\w+\s*\{\s*([^,\s]+)\s*,/g;

export interface BibAuditResult {
  citedKeys: string[];
  bibKeys: string[];
  unusedKeys: string[];
  missingKeys: string[];
}

/**
 * Reconciles citation keys between LaTeX sources and a BibTeX file.
 *
 * @usedBy vscode BibAuditProvider
 * @returns Sorted lists of cited, declared, unused, and missing keys.
 */
export function auditBibliography(
  texContents: string[],
  bibContent: string,
): BibAuditResult {
  const cited = new Set<string>();
  for (const tex of texContents) {
    for (const m of tex.matchAll(CITE_RE)) {
      const raw = m[1];
      if (!raw) continue;
      for (const key of raw.split(",").map((k) => k.trim())) {
        if (key) cited.add(key);
      }
    }
  }
  const declared = new Set<string>();
  for (const m of bibContent.matchAll(BIB_ENTRY_RE)) {
    const key = m[1];
    if (key) declared.add(key);
  }
  const unused = Array.from(declared).filter((k) => !cited.has(k)).sort();
  const missing = Array.from(cited).filter((k) => !declared.has(k)).sort();
  return {
    citedKeys: Array.from(cited).sort(),
    bibKeys: Array.from(declared).sort(),
    unusedKeys: unused,
    missingKeys: missing,
  };
}
