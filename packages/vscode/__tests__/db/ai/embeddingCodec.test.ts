import { decodeEmbedding, encodeEmbedding } from "../../../src/db/ai/embeddingCodec";

describe("embeddingCodec", () => {
  it("round-trips a Float32Array", () => {
    const original = new Float32Array([0.1, -0.5, 1e-3, 2.5]);
    const buf = encodeEmbedding(original);
    const decoded = decodeEmbedding(buf, original.length);
    expect(Array.from(decoded)).toEqual(Array.from(original));
  });

  it("throws on dimension mismatch", () => {
    const buf = encodeEmbedding(new Float32Array([1, 2, 3]));
    expect(() => decodeEmbedding(buf, 4)).toThrow();
  });
});
