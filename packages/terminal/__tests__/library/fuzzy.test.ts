import { fuzzyScore, rankFuzzy } from "../../src/library/fuzzy";

describe("fuzzyScore", () => {
  it("matches a subsequence and reports the matched positions in order", () => {
    const match = fuzzyScore("atn", "Attention Is All You Need");
    expect(match).toBeDefined();
    expect(match!.positions).toHaveLength(3);
    expect(match!.positions[0]).toBe(0);
    expect([...match!.positions].sort((a, b) => a - b)).toEqual(match!.positions);
  });

  it("returns undefined when the pattern is not a subsequence of the text", () => {
    expect(fuzzyScore("xyz", "abc")).toBeUndefined();
    expect(fuzzyScore("ba", "ab")).toBeUndefined();
    expect(fuzzyScore("aab", "ab")).toBeUndefined();
  });

  it("matches everything, with score 0, for an empty or blank pattern", () => {
    expect(fuzzyScore("", "anything")).toEqual({ score: 0, positions: [] });
    expect(fuzzyScore("   ", "anything")).toEqual({ score: 0, positions: [] });
  });

  it("ignores case, accents and spaces in the pattern", () => {
    expect(fuzzyScore("SCH", "Schrödinger")).toBeDefined();
    expect(fuzzyScore("schrod", "Schrödinger")).toBeDefined();
    expect(fuzzyScore("a t n", "Attention")!.positions).toEqual(fuzzyScore("atn", "Attention")!.positions);
  });

  it("scores consecutive matches above scattered ones", () => {
    expect(fuzzyScore("abc", "xabcxx")!.score).toBeGreaterThan(fuzzyScore("abc", "xaxbxc")!.score);
  });

  it("scores matches at word starts above matches inside words", () => {
    expect(fuzzyScore("ml", "machine learning")!.score).toBeGreaterThan(fuzzyScore("ml", "animal")!.score);
    expect(fuzzyScore("ml", "machine-learning")!.score).toBeGreaterThan(fuzzyScore("ml", "animal")!.score);
  });

  it("prefers a shorter text and an earlier first match", () => {
    expect(fuzzyScore("ab", "ab")!.score).toBeGreaterThan(fuzzyScore("ab", "ab and a lot of other words")!.score);
    expect(fuzzyScore("ab", "abxxxx")!.score).toBeGreaterThan(fuzzyScore("ab", "xxxxab")!.score);
  });
});

describe("rankFuzzy", () => {
  const label = (s: string): string => s;

  it("puts the word-start match first: atn finds Attention before Data anonymisation", () => {
    const items = ["Data anonymisation", "Attention Is All You Need", "Graph networks"];
    expect(rankFuzzy(items, "atn", label)[0]).toBe("Attention Is All You Need");
  });

  it("drops items whose label is not a match", () => {
    expect(rankFuzzy(["Attention", "Graph", "Vision"], "atn", label)).toEqual(["Attention"]);
    expect(rankFuzzy(["Attention"], "zzz", label)).toEqual([]);
  });

  it("orders consecutive matches before scattered ones", () => {
    const items = ["xaxbxc", "xabcxx"];
    expect(rankFuzzy(items, "abc", label)).toEqual(["xabcxx", "xaxbxc"]);
  });

  it("keeps the input order for an empty or blank pattern, as a copy", () => {
    const items = ["b", "a", "c"];
    const empty = rankFuzzy(items, "", label);
    expect(empty).toEqual(["b", "a", "c"]);
    expect(empty).not.toBe(items);
    expect(rankFuzzy(items, "   ", label)).toEqual(["b", "a", "c"]);
  });

  it("keeps the input order between equal scores", () => {
    expect(rankFuzzy(["ab-1", "ab-2", "ab-3"], "ab", label)).toEqual(["ab-1", "ab-2", "ab-3"]);
  });

  it("ranks arbitrary items through the label function", () => {
    const items = [{ id: 1, name: "Computer Vision" }, { id: 2, name: "Natural Language Processing" }];
    expect(rankFuzzy(items, "nlp", (i) => i.name).map((i) => i.id)).toEqual([2]);
    expect(rankFuzzy(items, "cv", (i) => i.name).map((i) => i.id)).toEqual([1]);
  });
});
