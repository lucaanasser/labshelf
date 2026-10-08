import { collectionTreeFromKeys, pdfDirsFromKeys } from "../../src/storage/folderTreeStore";

describe("collectionTreeFromKeys", () => {
  it("turns file keys into a nested collection tree, excluding paper folders", () => {
    const keys = [
      "papers/A/x1/paper.pdf", "papers/A/x1/metadata.yaml", "papers/A/x1/bib.bib",
      "papers/A/A1/y1/metadata.yaml",
      "papers/B/.keep",
      "papers/z0/paper.pdf",
    ];
    expect(collectionTreeFromKeys(keys, "papers")).toEqual([
      { name: "A", path: "papers/A", children: [{ name: "A1", path: "papers/A/A1", children: [] }] },
      { name: "B", path: "papers/B", children: [] },
    ]);
  });

  it("hides dot-directories and sorts case-insensitively", () => {
    const keys = ["papers/.trash/x/paper.pdf", "papers/beta/.keep", "papers/Alpha/.keep", "papers/gamma/inner/.keep"];
    const tree = collectionTreeFromKeys(keys, "papers");
    expect(tree.map((n) => n.name)).toEqual(["Alpha", "beta", "gamma"]);
    expect(tree[2]!.children.map((n) => n.name)).toEqual(["inner"]);
  });

  it("returns an empty tree when only papers sit at the root", () => {
    expect(collectionTreeFromKeys(["papers/p1/paper.pdf", "papers/p2/metadata.yaml"], "papers")).toEqual([]);
  });
});

describe("pdfDirsFromKeys", () => {
  it("collects the folder of every key ending in /paper.pdf, nested or at the root", () => {
    const keys = [
      "papers/A/x1/paper.pdf", "papers/A/x1/metadata.yaml", "papers/A/x1/bib.bib",
      "papers/A/A1/y1/paper.pdf",
      "papers/z0/paper.pdf",
      "papers/p2/metadata.yaml",
    ];
    expect(pdfDirsFromKeys(keys)).toEqual(new Set(["papers/A/x1", "papers/A/A1/y1", "papers/z0"]));
  });

  it("excludes conflict copies, backups and any basename that is not exactly paper.pdf", () => {
    const keys = [
      "papers/A/x1/paper (conflict 2026-05-22).pdf",
      "papers/A/x2/paper.pdf.bak",
      "papers/A/x3/notpaper.pdf",
      "papers/A/x4/paper.pdf",
    ];
    expect(pdfDirsFromKeys(keys)).toEqual(new Set(["papers/A/x4"]));
  });

  it("is empty when no key names a paper.pdf", () => {
    expect(pdfDirsFromKeys(["papers/A/x1/metadata.yaml", "papers/B/.keep"])).toEqual(new Set());
  });
});
