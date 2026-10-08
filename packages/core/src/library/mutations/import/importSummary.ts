/** The one message every app shows after an import, worded from its outcomes. */
import type { ImportOutcome } from "./paperImport.js";

export interface ImportSummary {
  level: "info" | "warn";
  text: string;
  /** The paper the app should select: the one added, or the one a lone duplicate matched. */
  reveal?: string;
}

type Outcome<S extends ImportOutcome["status"]> = Extract<ImportOutcome, { status: S }>;

function withStatus<S extends ImportOutcome["status"]>(outcomes: ImportOutcome[], status: S): Array<Outcome<S>> {
  return outcomes.filter((outcome): outcome is Outcome<S> => outcome.status === status);
}

/** @returns the summary; apps add their own prefix or shorten the title */
export function summarizeImport(outcomes: ImportOutcome[]): ImportSummary {
  const added = withStatus(outcomes, "added");
  const duplicates = withStatus(outcomes, "duplicate");
  const skipped = withStatus(outcomes, "skipped");
  const failed = withStatus(outcomes, "failed");
  if (!added.length && !duplicates.length && !failed.length) { return { level: "warn", text: "No PDF found there" }; }
  const alone = outcomes.length === 1;
  if (alone && added[0]) {
    const { record, needsReview } = added[0];
    const review = needsReview ? " — metadata unconfirmed, check it" : "";
    return { level: "info", text: `Added "${record.title}"${review}`, reveal: record.id };
  }
  if (alone && duplicates[0]) {
    const { existingId } = duplicates[0];
    return { level: "warn", text: `Already in the library as ${existingId}`, reveal: existingId };
  }
  const parts = [`${added.length} added`];
  if (duplicates.length) { parts.push(`${duplicates.length} already in the library`); }
  if (skipped.length) { parts.push(`${skipped.length} skipped`); }
  if (failed[0]) { parts.push(`${failed.length} failed: ${failed[0].error}`); }
  return { level: failed.length ? "warn" : "info", text: parts.join(", ") };
}
