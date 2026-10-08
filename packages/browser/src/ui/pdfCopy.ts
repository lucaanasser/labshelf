/**
 * Shared, pure copy for everything LabShelf says about a paper's PDF: the
 * resolver-name labels, the "No PDF found" dialog text, the attachments
 * heading and the popup's one-line status. Kept DOM-free so the popup, the
 * Google Scholar button and the library page all say the same thing and so it
 * can be unit-tested in node.
 * @depends platform/runtimeMessages (types)
 * @dependents popup/format, popup/index, content/scholar, library-page controllers
 */
import type { PdfMiss, PdfStatusData } from "../platform/runtimeMessages";

/** Human label for each resolver id. Kept here so every surface labels the same. */
export const SOURCE_LABELS: Record<string, string> = {
  page: "this page",
  scholar: "Google Scholar",
  publisher: "the publisher",
  arxiv: "arXiv",
  crossref: "CrossRef",
  unpaywall: "Unpaywall (open access)",
  pubmed: "PubMed",
  "sci-hub": "Sci-Hub",
};

/** Human label for a resolver name. */
export function pdfSourceLabel(source: string | undefined): string {
  return (source && SOURCE_LABELS[source]) || source || "the web";
}

// "this page, the publisher and Unpaywall (open access)" — de-duplicated
// labels, Oxford-free "and".
function joinLabels(sources: string[]): string {
  const labels = [...new Set(sources.map(pdfSourceLabel))];
  if (labels.length === 0) return "the web";
  if (labels.length === 1) return labels[0]!;
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]!}`;
}

/**
 * The "No PDF found" dialog's title and message, from what the search tried.
 * @usedBy popup/index, content/scholar, library-page controllers
 */
export function noPdfDialogCopy(title: string, miss: PdfMiss): { title: string; message: string } {
  const quoted = `"${title}"`;
  let message: string;
  if (miss.tried === 0) {
    message = `No PDF link, DOI or arXiv id was found for ${quoted}. Save the reference without a PDF? You can attach one later from the library.`;
  } else {
    const links = miss.tried === 1 ? "link" : "links";
    message = `Tried ${miss.tried} ${links} from ${joinLabels(miss.sources)}. Save ${quoted} without its PDF? You can attach one later from the library.`;
  }
  if (miss.blocked) {
    message += " Some links were behind a bot check — opening the PDF once in a tab can let LabShelf through.";
  }
  return { title: "No PDF found", message };
}

/** The attachments section heading: a paper has either its one PDF or none. */
export function attachmentsHeading(hasPdf: boolean): string {
  return hasPdf ? "1 Attachment" : "No PDF";
}

/**
 * The popup's one-line PDF status while searching, when found, and when the
 * search ended empty (the user is asked before anything is written).
 * @usedBy popup/index, popup/format
 */
export function pdfLineText(status: PdfStatusData | "searching"): string {
  if (status === "searching") return "Looking for the PDF…";
  if (status.found) return `PDF found · ${pdfSourceLabel(status.source)}`;
  const tried = status.miss?.tried ?? 0;
  if (tried > 0) {
    const links = tried === 1 ? "link" : "links";
    return `No PDF found (tried ${tried} ${links}) — you'll be asked before saving`;
  }
  return "No PDF found — you'll be asked before saving";
}
