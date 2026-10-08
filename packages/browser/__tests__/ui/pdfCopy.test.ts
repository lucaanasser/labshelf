import { attachmentsHeading, noPdfDialogCopy, pdfLineText, pdfSourceLabel } from "../../src/ui/pdfCopy";
import type { PdfMiss } from "../../src/platform/runtimeMessages";

const miss = (over: Partial<PdfMiss> = {}): PdfMiss => ({ tried: 0, sources: [], blocked: false, ...over });

describe("pdfSourceLabel", () => {
  it("labels known resolvers, passes through unknown ones, falls back to the web", () => {
    expect(pdfSourceLabel("unpaywall")).toBe("Unpaywall (open access)");
    expect(pdfSourceLabel("publisher")).toBe("the publisher");
    expect(pdfSourceLabel("mystery")).toBe("mystery");
    expect(pdfSourceLabel(undefined)).toBe("the web");
  });
});

describe("noPdfDialogCopy", () => {
  it("summarises a normal miss with the source list and the paper title", () => {
    const { title, message } = noPdfDialogCopy("Deep Learning", miss({ tried: 7, sources: ["page", "publisher", "unpaywall"] }));
    expect(title).toBe("No PDF found");
    expect(message).toContain("Tried 7 links from this page, the publisher and Unpaywall (open access).");
    expect(message).toContain('"Deep Learning"');
    expect(message).toContain("without its PDF");
    expect(message).not.toContain("bot check");
  });

  it("uses the singular 'link' when exactly one was tried", () => {
    expect(noPdfDialogCopy("X", miss({ tried: 1, sources: ["page"] })).message).toContain("Tried 1 link from this page.");
  });

  it("says no identifier was found when nothing was tried", () => {
    const { message } = noPdfDialogCopy("Ghost", miss({ tried: 0 }));
    expect(message).toContain("No PDF link, DOI or arXiv id was found for \"Ghost\"");
    expect(message).not.toContain("Tried");
  });

  it("adds the bot-check hint when some links were blocked", () => {
    expect(noPdfDialogCopy("X", miss({ tried: 3, sources: ["publisher"], blocked: true })).message)
      .toContain("behind a bot check");
  });
});

describe("attachmentsHeading", () => {
  it("names the one PDF or none", () => {
    expect(attachmentsHeading(true)).toBe("1 Attachment");
    expect(attachmentsHeading(false)).toBe("No PDF");
  });
});

describe("pdfLineText", () => {
  it("reads while searching, when found and when the search ends empty", () => {
    expect(pdfLineText("searching")).toBe("Looking for the PDF…");
    expect(pdfLineText({ found: true, source: "publisher" })).toBe("PDF found · the publisher");
    expect(pdfLineText({ found: false, miss: miss({ tried: 3, sources: ["page"] }) }))
      .toBe("No PDF found (tried 3 links) — you'll be asked before saving");
    expect(pdfLineText({ found: false, miss: miss({ tried: 1 }) }))
      .toBe("No PDF found (tried 1 link) — you'll be asked before saving");
    expect(pdfLineText({ found: false })).toBe("No PDF found — you'll be asked before saving");
  });
});
