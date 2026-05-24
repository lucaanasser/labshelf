import { cosine } from "../../src/rag/cosine";

describe("cosine", () => {
  it("returns 1 for identical vectors", () => {
    const v = new Float32Array([1, 0, 0]);
    expect(cosine(v, v)).toBeCloseTo(1, 5);
  });

  it("returns 0 for orthogonal vectors", () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([0, 1, 0]);
    expect(cosine(a, b)).toBeCloseTo(0, 5);
  });

  it("throws on dimension mismatch", () => {
    expect(() => cosine(new Float32Array([1]), new Float32Array([1, 2]))).toThrow();
  });

  it("returns 0 for a zero vector", () => {
    expect(cosine(new Float32Array([0, 0]), new Float32Array([1, 2]))).toBe(0);
  });
});
