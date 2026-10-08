import { folderName, folderPathLabel, metaLine, parseTags } from "../../src/popup/format";

describe("popup format", () => {
  it("writes the byline with surnames, et al. past three", () => {
    expect(metaLine({ authors: ["Alan Edelman", "Tomás A. Arias", "Steven T. Smith"], venue: "SIAM J. Matrix Anal. Appl.", year: 1998 }))
      .toBe("Edelman, Arias, Smith · SIAM J. Matrix Anal. Appl. · 1998");
    expect(metaLine({ authors: ["A B", "C D", "E F", "G H"], year: 2001 })).toBe("B et al. · 2001");
    expect(metaLine({ authors: [] })).toBe("");
  });

  it("parses comma separated tags, trimming and de-duplicating", () => {
    expect(parseTags(" ml, Thesis  ch2 ,ML;#survey,, ")).toEqual(["ml", "Thesis ch2", "survey"]);
    expect(parseTags("")).toEqual([]);
  });

  it("labels folders", () => {
    const folders = { folders: [{ path: "papers", label: "Library", depth: 0 }, { path: "papers/Thesis", label: "Thesis", depth: 1 }], lastFolder: "papers" };
    expect(folderName("papers", folders)).toBe("Library");
    expect(folderName("papers/Thesis", folders)).toBe("Thesis");
    expect(folderName("papers/Gone/Deep", folders)).toBe("Gone / Deep");
    expect(folderPathLabel("papers")).toBe("Library");
    expect(folderPathLabel("papers/Thesis/Chapter 2")).toBe("Thesis / Chapter 2");
  });
});
