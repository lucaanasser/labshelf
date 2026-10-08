import { esc, highlight, tokenize } from "../../src/ui/dom";

describe("esc", () => {
  it("escapes HTML metacharacters and stringifies nullish values", () => {
    expect(esc(`<a href="x">Tom & 'Jerry'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/a&gt;");
    expect(esc(null)).toBe("");
    expect(esc(2017)).toBe("2017");
  });
});

describe("tokenize", () => {
  it("lower-cases and drops empty tokens", () => {
    expect(tokenize("  Deep  Learning ")).toEqual(["deep", "learning"]);
    expect(tokenize("")).toEqual([]);
  });
});

describe("highlight", () => {
  it("wraps every case-insensitive token match in <mark> and escapes the rest", () => {
    expect(highlight("Attention <is> all", ["att", "all"])).toBe("<mark>Att</mark>ention &lt;is&gt; <mark>all</mark>");
  });
  it("never nests marks when matches overlap", () => {
    expect(highlight("abcdef", ["abc", "bcd"])).toBe("<mark>abc</mark><mark>d</mark>ef");
  });
  it("returns escaped text when nothing matches or there are no tokens", () => {
    expect(highlight("a & b", [])).toBe("a &amp; b");
    expect(highlight("a & b", ["zzz"])).toBe("a &amp; b");
  });
});
