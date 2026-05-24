import { searchByClaim } from "../../src/rag/stanceDetector";
import type { IEmbeddingProvider } from "../../src/types/embeddingProvider";
import type { IVectorStore, VectorMatch } from "../../src/types/vectorStore";

class FakeEmbedder implements IEmbeddingProvider {
  readonly dimensions = 3;
  readonly modelId = "fake";
  async embed(texts: string[]): Promise<Float32Array[]> {
    return texts.map((t) => {
      if (/\bsupports\b/.test(t) || /\bSUPPORT\b/.test(t)) return new Float32Array([1, 0, 0]);
      if (/\bcontradicts\b/.test(t) || /\bCONTRADICT\b/.test(t)) return new Float32Array([0, 1, 0]);
      return new Float32Array([0, 0, 1]);
    });
  }
}

class FakeStore implements IVectorStore {
  constructor(private matches: VectorMatch[]) {}
  async upsert(): Promise<void> {}
  async search(): Promise<VectorMatch[]> {
    return this.matches;
  }
  async deleteByPaper(): Promise<void> {}
}

describe("searchByClaim", () => {
  it("classifies matches into support and contradict", async () => {
    const store = new FakeStore([
      { id: 1, paperId: "A", kind: "section", score: 0.9, text: "SUPPORT marker phrase" },
      { id: 2, paperId: "B", kind: "section", score: 0.85, text: "CONTRADICT marker phrase" },
    ]);
    const results = await searchByClaim("any claim", new FakeEmbedder(), store);
    expect(results.find((r) => r.paperId === "A")!.stance).toBe("support");
    expect(results.find((r) => r.paperId === "B")!.stance).toBe("contradict");
  });

  it("returns empty when no matches reach the minimum score", async () => {
    const store = new FakeStore([
      { id: 1, paperId: "A", kind: "section", score: 0.1, text: "any" },
    ]);
    const results = await searchByClaim("c", new FakeEmbedder(), store, { minimumScore: 0.5 });
    expect(results).toEqual([]);
  });
});
