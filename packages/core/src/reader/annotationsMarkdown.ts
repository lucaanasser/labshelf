/**
 * Renders a paper's annotations as a Markdown reading-notes document grouped by page.
 */
import type { Annotation } from "../types/index.js";
import { authorYearLabel, cleanQuote, type CitablePaper } from "./citationFormat.js";

/**
 * Highlights become block quotes tagged with their colour; notes and comments become plain paragraphs.
 * @returns a Markdown document ending in a newline.
 */
export function formatAnnotationsMarkdown(paper: CitablePaper, annotations: readonly Annotation[]): string {
  const lines: string[] = [`# ${paper.title}`, "", `${authorYearLabel(paper)} · \`@${paper.citeKey}\``, ""];
  if (annotations.length === 0) {
    lines.push("_No annotations._", "");
    return lines.join("\n");
  }
  const sorted = [...annotations].sort(
    (a, b) => a.pageNumber - b.pageNumber || a.createdAt.localeCompare(b.createdAt),
  );
  let page = -1;
  for (const ann of sorted) {
    if (ann.pageNumber !== page) {
      page = ann.pageNumber;
      lines.push(`## Page ${page}`, "");
    }
    const body = cleanQuote(ann.content);
    if (ann.type === "highlight") {
      lines.push(`> ${body}`, "", `<!-- highlight: ${ann.color ?? "yellow"} --> [@${paper.citeKey}, p. ${page}]`, "");
    } else {
      lines.push(`**${ann.type[0]!.toUpperCase()}${ann.type.slice(1)}:** ${body}`, "");
    }
  }
  return lines.join("\n");
}
