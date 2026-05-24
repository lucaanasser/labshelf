import { detectCitationGaps } from "../../src/analysis/citationGapDetector";
import type { CitationNode } from "../../src/types/citationGraph";

describe("detectCitationGaps", () => {
  it("returns references cited frequently but absent from the library", () => {
    const local: CitationNode[] = [
      { paperId: "p1", title: "Local A", isLocal: true },
      { paperId: "p2", title: "Local B", isLocal: true },
    ];
    const refs = [
      { fromPaperId: "p1", referencedTitle: "Missing Foundational Paper" },
      { fromPaperId: "p2", referencedTitle: "Missing Foundational Paper" },
      { fromPaperId: "p1", referencedTitle: "Missing Foundational Paper" },
      { fromPaperId: "p1", referencedTitle: "Local A" },
    ];
    const gaps = detectCitationGaps(local, refs, 2);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.title).toBe("Missing Foundational Paper");
    expect(gaps[0]!.citationCount).toBe(3);
  });

  it("filters out references that map back to local titles", () => {
    const local: CitationNode[] = [{ paperId: "p", title: "Attention Is All You Need", isLocal: true }];
    const refs = Array.from({ length: 4 }, (_, i) => ({
      fromPaperId: `q${i}`,
      referencedTitle: "Attention Is All You Need",
    }));
    expect(detectCitationGaps(local, refs)).toEqual([]);
  });
});
