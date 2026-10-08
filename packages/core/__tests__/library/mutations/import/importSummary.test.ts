import { summarizeImport, type ImportOutcome, type PaperRecord } from "@labshelf/core";

function addedOutcome(id: string, title: string, needsReview = false): ImportOutcome {
  const record: PaperRecord = { id, title, path: `/lib/papers/${id}`, citeKey: id, status: "unread", hasPdf: true };
  return { status: "added", record, needsReview, input: `/in/${id}.pdf` };
}

const duplicate: ImportOutcome = { status: "duplicate", existingId: "old", input: "/in/d.pdf" };
const failed = (error: string): ImportOutcome => ({ status: "failed", error, input: "/in/f.pdf" });
const skipped: ImportOutcome = { status: "skipped", input: "/in/x" };

describe("summarizeImport (BC14, terminal wording)", () => {
  it("warns when nothing was found", () => {
    expect(summarizeImport([])).toEqual({ level: "warn", text: "No PDF found there" });
    expect(summarizeImport([skipped])).toEqual({ level: "warn", text: "No PDF found there" });
  });

  it("names a single added paper in full and reveals it", () => {
    const title = "A very long title that the app may shorten for its own surface, but core never does";
    expect(summarizeImport([addedOutcome("p1", title)])).toEqual({ level: "info", text: `Added "${title}"`, reveal: "p1" });
  });

  it("asks to check a single added paper whose metadata is unconfirmed", () => {
    expect(summarizeImport([addedOutcome("p1", "T", true)]).text).toBe('Added "T" — metadata unconfirmed, check it');
  });

  it("reveals the paper a lone duplicate matched", () => {
    expect(summarizeImport([duplicate])).toEqual({ level: "warn", text: "Already in the library as old", reveal: "old" });
  });

  it("counts a mixed batch, with the first failure's reason", () => {
    expect(summarizeImport([addedOutcome("a", "A"), addedOutcome("b", "B"), duplicate, skipped, failed("Not a PDF file"), failed("other")]))
      .toEqual({ level: "warn", text: "2 added, 1 already in the library, 1 skipped, 2 failed: Not a PDF file" });
    expect(summarizeImport([addedOutcome("a", "A"), addedOutcome("b", "B")])).toEqual({ level: "info", text: "2 added" });
    expect(summarizeImport([addedOutcome("a", "A"), skipped])).toEqual({ level: "info", text: "1 added, 1 skipped" });
    expect(summarizeImport([failed("boom")])).toEqual({ level: "warn", text: "0 added, 1 failed: boom" });
  });
});
