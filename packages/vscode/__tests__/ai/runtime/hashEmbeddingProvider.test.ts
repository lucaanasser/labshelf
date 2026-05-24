import { HashEmbeddingProvider } from "../../../src/ai/runtime/hashEmbeddingProvider";

describe("HashEmbeddingProvider", () => {
  it("returns one vector per input", async () => {
    const provider = new HashEmbeddingProvider(64);
    const vectors = await provider.embed(["alpha beta", "gamma delta"]);
    expect(vectors).toHaveLength(2);
    expect(vectors[0]!.length).toBe(64);
  });

  it("is deterministic", async () => {
    const provider = new HashEmbeddingProvider(32);
    const [a] = await provider.embed(["the quick brown fox"]);
    const [b] = await provider.embed(["the quick brown fox"]);
    expect(Array.from(a!)).toEqual(Array.from(b!));
  });

  it("produces L2-normalised vectors", async () => {
    const provider = new HashEmbeddingProvider(32);
    const [v] = await provider.embed(["alpha beta gamma"]);
    let sq = 0;
    for (const x of v!) sq += x * x;
    expect(Math.sqrt(sq)).toBeCloseTo(1, 5);
  });

  it("returns a zero vector for empty input", async () => {
    const provider = new HashEmbeddingProvider(8);
    const [v] = await provider.embed([""]);
    for (const x of v!) expect(x).toBe(0);
  });
});
