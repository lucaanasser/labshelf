jest.mock("webextension-polyfill", () => ({ storage: { local: { get: async () => ({}), set: async () => undefined } } }));

import { scholarCacheKey } from "../../src/background/draftCache";
import type { ScholarHit } from "../../src/platform/runtimeMessages";

const hit = (over: Partial<ScholarHit> = {}): ScholarHit => ({ key: "cid1", title: "A Title", authors: [], ...over });

describe("scholarCacheKey", () => {
  it("is stable for the same result and ignores non-identity fields", () => {
    expect(scholarCacheKey(hit())).toBe(scholarCacheKey(hit()));
    // authors / venue / year are not part of the identity.
    expect(scholarCacheKey(hit({ authors: ["X"], year: 2020 }))).toBe(scholarCacheKey(hit({ authors: ["Y"], year: 1999 })));
  });

  it("separates results that differ in cluster id, landing url, PDF url or title", () => {
    const base = scholarCacheKey(hit());
    expect(scholarCacheKey(hit({ key: "cid2" }))).not.toBe(base);
    expect(scholarCacheKey(hit({ url: "https://a" }))).not.toBe(scholarCacheKey(hit({ url: "https://b" })));
    expect(scholarCacheKey(hit({ pdfUrl: "https://a.pdf" }))).not.toBe(scholarCacheKey(hit({ pdfUrl: "https://b.pdf" })));
    expect(scholarCacheKey(hit({ title: "Other" }))).not.toBe(base);
  });
});
