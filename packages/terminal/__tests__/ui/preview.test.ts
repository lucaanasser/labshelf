import type { Annotation, PaperRecord, PaperStatus, PaperData } from "@labshelf/core";

import type { CollectionNode, LibrarySnapshot, PaperEntry } from "../../src/library/libraryScanner";
import { stringWidth } from "../../src/tui/text";
import {
  folderPreview,
  infoLines,
  libraryOverview,
  paperLabel,
  paperPreview,
  PREVIEW_TABS,
  tabBar,
  type Line,
} from "../../src/ui/preview";
import { theme } from "../../src/ui/theme";

const text = (lines: Line[]): string[] => lines.map((line) => line.map((segment) => segment.text).join(""));

function record(extra: Partial<PaperRecord> = {}): PaperRecord {
  return { id: "vaswani2017attention", title: "Attention Is All You Need", path: "/lib/papers/vaswani2017attention", citeKey: "vaswani2017attention", status: "unread", hasPdf: true, ...extra };
}

function entry(extra: Partial<PaperRecord> = {}, collection = "", pdfBytes?: number): PaperEntry {
  return { record: record(extra), collection, modifiedMs: 1, ...(pdfBytes !== undefined ? { pdfBytes } : {}) };
}

function annotation(pageNumber: number, content: string, extra: Partial<Annotation> = {}): Annotation {
  return {
    id: `a-${pageNumber}-${content.length}`,
    paperId: "vaswani2017attention",
    type: "highlight",
    pageNumber,
    content,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...extra,
  };
}

function sidecar(annotations: Annotation[], extra: Partial<PaperData> = {}): PaperData {
  return { annotations, theme: "auto", ...extra };
}

describe("PREVIEW_TABS", () => {
  it("lists the tabs in the order Tab cycles through them", () => {
    expect([...PREVIEW_TABS]).toEqual(["Info", "Abstract", "Notes", "BibTeX"]);
  });
});

describe("infoLines", () => {
  const full = entry(
    {
      authors: ["Ashish Vaswani", "Noam Shazeer"],
      year: 2017,
      journal: "NeurIPS",
      status: "reading",
      tags: ["nlp", "transformers"],
      doi: "10.5555/3295222.3295349",
    },
    "ML/Transformers",
    812 * 1024,
  );

  it("lays out title, authors, venue, status, tags, key, DOI, location and PDF size", () => {
    expect(text(infoLines(full, undefined, 50))).toEqual([
      "Attention Is All You Need",
      "Ashish Vaswani, Noam Shazeer",
      "NeurIPS · 2017",
      "",
      "Status ◐ reading",
      "Tags   #nlp #transformers",
      "Key    vaswani2017attention",
      "DOI    10.5555/3295222.3295349",
      "In     ML › Transformers",
      "PDF    812 KB",
    ]);
  });

  it("shows the status of an unread and a finished paper", () => {
    expect(text(infoLines(entry({ status: "unread" }), undefined, 50))).toContain("Status ○ unread");
    expect(text(infoLines(entry({ status: "done" }), undefined, 50))).toContain("Status ● done");
  });

  it("omits the tags line when the paper has none", () => {
    expect(text(infoLines(entry(), undefined, 50)).some((line) => line.startsWith("Tags"))).toBe(false);
  });

  it("shows the URL when there is no DOI", () => {
    const lines = text(infoLines(entry({ url: "https://arxiv.org/abs/1706.03762" }), undefined, 60));
    expect(lines).toContain("URL    https://arxiv.org/abs/1706.03762");
    expect(lines.some((line) => line.startsWith("DOI"))).toBe(false);
  });

  it("prefers the DOI over the URL", () => {
    const lines = text(infoLines(entry({ doi: "10.1/x", url: "https://example.org" }), undefined, 60));
    expect(lines).toContain("DOI    10.1/x");
    expect(lines.some((line) => line.startsWith("URL"))).toBe(false);
  });

  it("says the PDF is missing on this device when the paper has no PDF here", () => {
    const lines = text(infoLines(entry({ hasPdf: false }), undefined, 50));
    expect(lines).toContain("PDF    not on this device");
  });

  it("draws the missing-PDF notice in the warning style", () => {
    const line = infoLines(entry({ hasPdf: false }), undefined, 50).find((l) => l[0]?.text.startsWith("PDF"));
    expect(line?.[1]?.style).toEqual(theme.warn);
  });

  it("shows yes for a PDF of unknown size", () => {
    expect(text(infoLines(entry(), undefined, 50))).toContain("PDF    yes");
  });

  it("shows where the paper lives, and library root for unfiled papers", () => {
    expect(text(infoLines(entry({}, ""), undefined, 50))).toContain("In     library root");
    expect(text(infoLines(entry({}, "Physics"), undefined, 50))).toContain("In     Physics");
  });

  it("describes the text layer", () => {
    const layer = (info: NonNullable<PaperRecord["textLayer"]>): string[] => text(infoLines(entry({ textLayer: info }), undefined, 60));
    expect(layer({ state: "native", checkedAt: "" })).toContain("Text   searchable");
    expect(layer({ state: "ocr", ocrPages: 12, checkedAt: "" })).toContain("Text   searchable (OCR, 12 pages)");
    expect(layer({ state: "ocr", checkedAt: "" })).toContain("Text   searchable (OCR)");
    expect(layer({ state: "missing", checkedAt: "" })).toContain("Text   scanned, not searchable");
    expect(layer({ state: "failed", reason: "password protected", checkedAt: "" })).toContain("Text   unreadable (password protected)");
  });

  it("omits the text line for a PDF that was never checked", () => {
    expect(text(infoLines(entry(), undefined, 50)).some((line) => line.startsWith("Text"))).toBe(false);
  });

  it("counts highlights from the sidecar and points to the Notes tab", () => {
    const two = sidecar([annotation(1, "a"), annotation(2, "b")]);
    expect(text(infoLines(entry(), two, 60))).toContain("Notes  2 highlights — Tab to read");
    expect(text(infoLines(entry(), sidecar([annotation(1, "a")]), 60))).toContain("Notes  1 highlight — Tab to read");
  });

  it("omits the notes line without highlights", () => {
    expect(text(infoLines(entry(), sidecar([]), 60)).some((line) => line.startsWith("Notes"))).toBe(false);
  });

  it("shows where reading stopped", () => {
    const data = sidecar([], { reading: { page: 7, scaleValue: "auto", updatedAt: "2026-01-01T00:00:00.000Z" } });
    expect(text(infoLines(entry(), data, 60))).toContain("Read   stopped at page 7");
  });

  it("shows the user's note below a blank line", () => {
    const lines = text(infoLines(entry({ note: "Revisit section 3.2" }), undefined, 50));
    expect(lines.slice(-3)).toEqual(["", "Note", "Revisit section 3.2"]);
  });

  it("omits a blank note", () => {
    expect(text(infoLines(entry({ note: "   \n " }), undefined, 50))).not.toContain("Note");
  });

  it("limits the title to four lines and marks the cut", () => {
    const title = Array.from({ length: 30 }, (_, i) => `word${i}`).join(" ");
    const lines = text(infoLines(entry({ title }), undefined, 20));
    const blank = lines.indexOf("");
    expect(blank).toBe(4);
    expect(lines[3]!.endsWith("…")).toBe(true);
  });

  it("wraps long values with the label column left empty on continuation lines", () => {
    const doi = "10.1234/" + "x".repeat(40);
    const lines = text(infoLines(entry({ doi }), undefined, 24));
    const start = lines.findIndex((line) => line.startsWith("DOI"));
    expect(start).toBeGreaterThan(-1);
    expect(lines[start + 1]!.startsWith("       ")).toBe(true);
    expect(lines.slice(start, start + 3).map((line) => line.slice(7)).join("")).toBe(doi);
  });

  it("never exceeds the width", () => {
    const wide = entry({
      title: "A very long title that goes on and on about transformers and attention",
      authors: ["First Author", "Second Author", "Third Author"],
      doi: "10.1234/" + "y".repeat(60),
      note: "A long note ".repeat(20),
    }, "Some/Deep/Folder/Path");
    for (const width of [24, 40, 80]) {
      for (const line of text(infoLines(wide, undefined, width))) {
        expect(stringWidth(line)).toBeLessThanOrEqual(width);
      }
    }
  });
});

describe("paperPreview Info tab", () => {
  it("returns the info lines and wants room for a thumbnail when the PDF exists", () => {
    const preview = paperPreview(entry({}, "", 1000), undefined, "Info", 50, "");
    expect(text(preview.lines)).toEqual(text(infoLines(entry({}, "", 1000), undefined, 50)));
    expect(preview.wantsImage).toBe(true);
  });

  it("does not want a thumbnail for a paper without a PDF here", () => {
    expect(paperPreview(entry({ hasPdf: false }), undefined, "Info", 50, "").wantsImage).toBe(false);
  });
});

describe("paperPreview Abstract tab", () => {
  it("shows the abstract wrapped to the width", () => {
    const summary = "The dominant sequence transduction models are based on complex recurrent or convolutional neural networks.";
    const preview = paperPreview(entry({ summary }), undefined, "Abstract", 30, "");
    const lines = text(preview.lines);
    expect(lines.length).toBeGreaterThan(2);
    expect(lines.join(" ")).toBe(summary);
    expect(lines.every((line) => stringWidth(line) <= 30)).toBe(true);
    expect(preview.wantsImage).toBe(false);
  });

  it("says when no abstract is stored", () => {
    expect(text(paperPreview(entry(), undefined, "Abstract", 40, "").lines)).toEqual(["No abstract stored for this paper."]);
  });

  it("says so for a blank abstract too", () => {
    expect(text(paperPreview(entry({ summary: "  \n " }), undefined, "Abstract", 40, "").lines)).toEqual(["No abstract stored for this paper."]);
  });

  it("lists keywords under the abstract", () => {
    const lines = text(paperPreview(entry({ summary: "Short.", keywords: ["attention", "transformer"] }), undefined, "Abstract", 40, "").lines);
    expect(lines).toEqual(["Short.", "", "Keywords", "attention, transformer"]);
  });

  it("lists keywords even without an abstract", () => {
    const lines = text(paperPreview(entry({ keywords: ["a"] }), undefined, "Abstract", 40, "").lines);
    expect(lines).toEqual(["No abstract stored for this paper.", "", "Keywords", "a"]);
  });
});

describe("paperPreview Notes tab", () => {
  it("explains that there are no highlights yet", () => {
    const lines = text(paperPreview(entry(), undefined, "Notes", 60, "").lines);
    expect(lines[0]).toBe("No highlights or notes yet.");
    expect(lines.join(" ")).toContain("reader");
  });

  it("explains the same for an empty sidecar", () => {
    expect(text(paperPreview(entry(), sidecar([]), "Notes", 60, "").lines)[0]).toBe("No highlights or notes yet.");
  });

  it("groups highlights under their page, with a blank line between pages", () => {
    const data = sidecar([
      annotation(1, "first on one"),
      annotation(1, "second on one"),
      annotation(3, "only on three"),
    ]);
    expect(text(paperPreview(entry(), data, "Notes", 40, "").lines)).toEqual([
      "p. 1",
      "▌ first on one",
      "▌ second on one",
      "",
      "p. 3",
      "▌ only on three",
    ]);
  });

  it("collapses the PDF's line breaks and de-hyphenates highlighted text", () => {
    const quote = "The dominant sequence\ntransduction mod-\nels are based on\ncomplex   recurrent";
    const lines = text(paperPreview(entry(), sidecar([annotation(2, quote)]), "Notes", 80, "").lines);
    expect(lines).toEqual(["p. 2", "▌ The dominant sequence transduction models are based on complex recurrent"]);
  });

  it("wraps long highlights and repeats the bar on each row", () => {
    const quote = "one two three four five six seven eight nine ten";
    const lines = text(paperPreview(entry(), sidecar([annotation(1, quote)]), "Notes", 22, "").lines);
    const rows = lines.slice(1);
    expect(rows.length).toBeGreaterThan(1);
    expect(rows.every((row) => row.startsWith("▌ "))).toBe(true);
    expect(rows.map((row) => row.slice(2)).join(" ")).toBe(quote);
    expect(rows.every((row) => stringWidth(row) <= 22)).toBe(true);
  });

  it("keeps the line breaks of a typed note and draws it in bold", () => {
    const data = sidecar([annotation(4, "Check section 3\nagainst Table 2", { type: "note" })]);
    const lines = paperPreview(entry(), data, "Notes", 60, "").lines;
    expect(text(lines)).toEqual(["p. 4", "▌ Check section 3", "▌ against Table 2"]);
    expect(lines[1]![1]!.style).toEqual(theme.bold);
  });

  it("draws highlight text in the default style", () => {
    const lines = paperPreview(entry(), sidecar([annotation(1, "plain")]), "Notes", 60, "").lines;
    expect(lines[1]![1]!.style).toBeUndefined();
  });

  it("colors the bar like the annotation", () => {
    const data = sidecar([annotation(1, "red one", { color: "red" }), annotation(1, "green one", { color: "green" })]);
    const lines = paperPreview(entry(), data, "Notes", 60, "").lines;
    expect(lines[1]![0]!.style).toEqual(theme.annotation["red"]);
    expect(lines[2]![0]!.style).toEqual(theme.annotation["green"]);
  });

  it("uses yellow when the annotation has no color or an unknown one", () => {
    const unknown = annotation(1, "mystery", { color: "chartreuse" as unknown as NonNullable<Annotation["color"]> });
    const data = sidecar([annotation(1, "no color"), unknown]);
    const lines = paperPreview(entry(), data, "Notes", 60, "").lines;
    expect(lines[1]![0]!.style).toEqual(theme.annotation["yellow"]);
    expect(lines[2]![0]!.style).toEqual(theme.annotation["yellow"]);
  });

  it("shows a placeholder for an annotation without text", () => {
    const lines = text(paperPreview(entry(), sidecar([annotation(1, "   \n  ")]), "Notes", 60, "").lines);
    expect(lines).toEqual(["p. 1", "▌ (empty)"]);
  });

  it("does not want a thumbnail", () => {
    expect(paperPreview(entry(), undefined, "Notes", 60, "").wantsImage).toBe(false);
  });
});

describe("paperPreview BibTeX tab", () => {
  const bibtex = [
    "@article{vaswani2017attention,",
    "  title = {Attention Is All You Need},",
    "  author = {Vaswani, Ashish and Shazeer, Noam and Parmar, Niki and Uszkoreit, Jakob},",
    "  year = {2017}",
    "}",
  ].join("\n");

  it("shows short lines unchanged, keeping their indentation", () => {
    expect(text(paperPreview(entry(), undefined, "BibTeX", 120, bibtex).lines)).toEqual(bibtex.split("\n"));
  });

  it("keeps the indentation of a wrapped line and indents its continuation further", () => {
    const lines = text(paperPreview(entry(), undefined, "BibTeX", 40, bibtex).lines);
    const start = lines.findIndex((line) => line.startsWith("  author"));
    expect(start).toBeGreaterThan(-1);
    const continuation = lines.slice(start + 1).filter((line) => line.startsWith("    "));
    expect(continuation.length).toBeGreaterThan(0);
    expect(lines[start]!.startsWith("  author = {Vaswani, Ashish and")).toBe(true);
    // The wrapped words are all still there, in order.
    const joined = lines.slice(start, start + 1 + continuation.length).map((line) => line.trim()).join(" ");
    expect(joined).toBe("author = {Vaswani, Ashish and Shazeer, Noam and Parmar, Niki and Uszkoreit, Jakob},");
  });

  it("never exceeds the width", () => {
    for (const width of [20, 30, 40]) {
      for (const line of text(paperPreview(entry(), undefined, "BibTeX", width, bibtex).lines)) {
        expect(stringWidth(line)).toBeLessThanOrEqual(width);
      }
    }
  });

  it("keeps the entry's first and last lines at no indentation", () => {
    const lines = text(paperPreview(entry(), undefined, "BibTeX", 40, bibtex).lines);
    expect(lines[0]).toBe("@article{vaswani2017attention,");
    expect(lines[lines.length - 1]).toBe("}");
  });

  it("keeps blank lines between entries", () => {
    const lines = text(paperPreview(entry(), undefined, "BibTeX", 40, "@a{x,\n}\n\n@b{y,\n}").lines);
    expect(lines).toEqual(["@a{x,", "}", "", "@b{y,", "}"]);
  });

  it("does not want a thumbnail", () => {
    expect(paperPreview(entry(), undefined, "BibTeX", 40, bibtex).wantsImage).toBe(false);
  });
});

describe("tabBar", () => {
  it("shows every tab as a padded label", () => {
    expect(text([tabBar("Info", 0)])).toEqual([" Info  Abstract  Notes  BibTeX "]);
  });

  it("highlights only the active tab", () => {
    for (const [index, tab] of PREVIEW_TABS.entries()) {
      const styles = tabBar(tab, 0).map((segment) => segment.style);
      styles.forEach((style, i) => expect(style).toEqual(i === index ? theme.tabActive : theme.tabInactive));
    }
  });

  it("shows the number of highlights on the Notes tab", () => {
    expect(text([tabBar("Info", 3)])).toEqual([" Info  Abstract  Notes 3  BibTeX "]);
  });

  it("keeps the count when the Notes tab is active", () => {
    const line = tabBar("Notes", 12);
    expect(text([line])).toEqual([" Info  Abstract  Notes 12  BibTeX "]);
    expect(line[2]!.style).toEqual(theme.tabActive);
  });
});

function snapshotOf(entries: PaperEntry[], collections: CollectionNode[]): LibrarySnapshot {
  return {
    root: "/lib",
    papers: new Map(entries.map((e) => [e.record.id, e])),
    collections: new Map(collections.map((node) => [node.rel, node])),
    duplicates: [],
    orphans: [],
    scannedAt: 1,
  };
}

function node(rel: string, children: string[], paperIds: string[], total: number): CollectionNode {
  const parts = rel.split("/").filter(Boolean);
  return {
    rel,
    name: rel ? parts[parts.length - 1]! : "papers",
    parent: rel ? parts.slice(0, -1).join("/") : undefined,
    children,
    paperIds,
    total,
  };
}

function paper(id: string, status: PaperStatus, collection: string, extra: Partial<PaperRecord> = {}): PaperEntry {
  return entry({ id, title: `Paper ${id}`, citeKey: id, status, ...extra }, collection);
}

describe("folderPreview and libraryOverview", () => {
  const p0 = paper("p0", "unread", "");
  const p1 = paper("p1", "reading", "ML");
  const p2 = paper("p2", "done", "ML/NLP");
  const snapshot = snapshotOf([p0, p1, p2], [
    node("", ["ML"], ["p0"], 3),
    node("ML", ["ML/NLP"], ["p1"], 2),
    node("ML/NLP", [], ["p2"], 1),
    node("Empty", [], [], 0),
  ]);

  it("summarizes a folder: counts, status breakdown, subfolders and its own papers", () => {
    const lines = text(folderPreview(snapshot.collections.get("ML")!, snapshot, [p1]));
    expect(lines).toEqual([
      "ML",
      "2 papers · 1 subfolder",
      "◐ 1 reading  ○ 0 unread  ● 1 done",
      "",
      "NLP/ 1",
      "",
      "◐ Paper p1",
    ]);
  });

  it("uses the given label as the title", () => {
    expect(text(folderPreview(snapshot.collections.get("ML/NLP")!, snapshot, [p2], "ML › NLP"))[0]).toBe("ML › NLP");
  });

  it("uses the singular for one paper and omits the subfolder count when there are none", () => {
    const lines = text(folderPreview(snapshot.collections.get("ML/NLP")!, snapshot, [p2]));
    expect(lines[1]).toBe("1 paper");
    expect(lines).toEqual(["NLP", "1 paper", "◐ 0 reading  ○ 0 unread  ● 1 done", "", "● Paper p2"]);
  });

  it("counts statuses over the whole subtree and over everything for the root", () => {
    const root = text(folderPreview(snapshot.collections.get("")!, snapshot, [p0]));
    expect(root[2]).toBe("◐ 1 reading  ○ 1 unread  ● 1 done");
  });

  it("says when a folder is empty", () => {
    expect(text(folderPreview(snapshot.collections.get("Empty")!, snapshot, []))).toEqual(["Empty", "0 papers", "", "Empty folder"]);
  });

  it("draws papers without a PDF in the no-PDF style", () => {
    const noPdf = paper("p3", "unread", "Empty", { hasPdf: false });
    const lines = folderPreview(node("Empty", [], ["p3"], 1), snapshotOf([noPdf], []), [noPdf]);
    const row = lines[lines.length - 1]!;
    expect(row[1]!.style).toEqual(theme.noPdf);
  });

  it("summarizes the library", () => {
    expect(text(libraryOverview(snapshot))).toEqual([
      "Library",
      "3 papers",
      "",
      "◐ 1 reading",
      "○ 1 unread",
      "● 1 done",
      "",
      "3 with PDF",
    ]);
  });

  it("counts only papers with a PDF here in the overview", () => {
    const withoutPdf = snapshotOf([p0, paper("p9", "done", "", { hasPdf: false })], []);
    const lines = text(libraryOverview(withoutPdf));
    expect(lines[1]).toBe("2 papers");
    expect(lines[lines.length - 1]).toBe("1 with PDF");
  });

  it("summarizes an empty library", () => {
    expect(text(libraryOverview(snapshotOf([], [])))).toEqual([
      "Library", "0 papers", "", "◐ 0 reading", "○ 0 unread", "● 0 done", "", "0 with PDF",
    ]);
  });
});

describe("paperLabel", () => {
  it("joins title, first author and year", () => {
    expect(paperLabel(record({ authors: ["Ashish Vaswani"], year: 2017 }))).toBe("Attention Is All You Need · Vaswani · 2017");
  });

  it("abbreviates several authors", () => {
    expect(paperLabel(record({ authors: ["Ashish Vaswani", "Noam Shazeer"], year: 2017 }))).toBe("Attention Is All You Need · Vaswani et al. · 2017");
  });

  it("skips what is missing", () => {
    expect(paperLabel(record())).toBe("Attention Is All You Need");
    expect(paperLabel(record({ year: 2017 }))).toBe("Attention Is All You Need · 2017");
  });
});

describe("BibTeX wrapping regressions", () => {
  it("keeps a first line that fits exactly in one row", () => {
    const bibtex = "@article{vaswani2017attention,\n  title = {Attention},\n}";
    const lines = text(paperPreview(entry(), undefined, "BibTeX", 30, bibtex).lines);
    expect(lines[0]).toBe("@article{vaswani2017attention,");
  });
});
