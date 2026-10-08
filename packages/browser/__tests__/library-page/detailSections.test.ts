import { multiDetailHtml, paperDetailHtml } from "../../src/library-page/views/detailSections";
import type { DetailViewState } from "../../src/library-page/views/detailSections";
import type { ListPaper } from "../../src/library-page/state/derive";

function listPaper(extra: Partial<ListPaper> = {}): ListPaper {
  return {
    id: "p1",
    title: "A Paper",
    path: "papers/p1",
    citeKey: "a2020",
    status: "unread",
    folderPath: "papers",
    relFolder: "",
    hay: "",
    hasPdf: false,
    ...extra,
  };
}

const view: DetailViewState = { collapsed: {}, abstractOpen: false, openFolder: "papers", pdfBusy: false };

describe("paperDetailHtml — honest attachments", () => {
  it("a paper without a PDF offers Find PDF and Attach PDF, and never Open PDF or paper.pdf", () => {
    const html = paperDetailHtml(listPaper({ hasPdf: false }), view);
    expect(html).toContain('data-action="find-pdf"');
    expect(html).toContain('data-action="attach-pdf"');
    expect(html).not.toContain('data-action="open-pdf"');
    expect(html).toContain("No PDF");            // heading + "No PDF attached" note
    expect(html).not.toContain("1 Attachment");
    expect(html).not.toContain("paper.pdf");
  });

  it("a paper with a PDF shows Open PDF, the 1 Attachment heading and paper.pdf", () => {
    const html = paperDetailHtml(listPaper({ hasPdf: true }), view);
    expect(html).toContain('data-action="open-pdf"');
    expect(html).toContain("1 Attachment");
    expect(html).toContain("paper.pdf");
    expect(html).not.toContain('data-action="find-pdf"');
    expect(html).not.toContain('data-action="attach-pdf"');
  });

  it("while a search is in flight the Find button is disabled and reads Searching", () => {
    const html = paperDetailHtml(listPaper({ hasPdf: false }), { ...view, pdfBusy: true });
    expect(html).toContain('data-action="find-pdf"');
    expect(html).toContain("disabled");
    expect(html).toContain("Searching");
    // The busy body replaces the empty-state buttons, so there is no Attach action yet.
    expect(html).not.toContain('data-action="attach-pdf"');
  });
});

describe("multiDetailHtml", () => {
  it("never offers Open PDF or Find PDF for a multi-selection", () => {
    const html = multiDetailHtml(3);
    expect(html).toContain("3 papers selected");
    expect(html).not.toContain('data-action="open-pdf"');
    expect(html).not.toContain('data-action="find-pdf"');
  });
});
