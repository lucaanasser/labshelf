import { citeKeySlug, claimCiteKey, makeCiteKey, uniqueCiteKey } from "@labshelf/core";

describe("citeKeySlug", () => {
  it("strips accents, case and punctuation", () => {
    expect(citeKeySlug("Müller-Ñandú!")).toBe("mullernandu");
  });
});

describe("makeCiteKey", () => {
  it("builds authorYearWord from the first author's family name, the year and the first meaningful title word", () => {
    expect(makeCiteKey({ authors: ["Ashish Vaswani", "Noam Shazeer"], year: 2017, title: "Attention Is All You Need" }, "x"))
      .toBe("vaswani2017attention");
    expect(makeCiteKey({ authors: ["Alok Aggarwal"], year: 1986, title: "Geometric applications of a matrix searching algorithm" }, "x"))
      .toBe("aggarwal1986geometric");
  });

  it("skips stop words and one-letter words in the title", () => {
    expect(makeCiteKey({ authors: ["Ann Lee"], year: 2020, title: "The Role of Attention" }, "x")).toBe("lee2020role");
    expect(makeCiteKey({ authors: ["Ann Lee"], year: 2020, title: "A B Transformer" }, "x")).toBe("lee2020transformer");
    expect(makeCiteKey({ authors: ["José Müller"], year: 2020, title: "A study of the ocean" }, "x")).toBe("muller2020study");
  });

  it("strips accents and punctuation", () => {
    expect(makeCiteKey({ authors: ["José Müller-Ñandú"], year: 2021, title: "Über-Models" }, "x")).toBe("mullernandu2021uber" + "models");
  });

  it("uses the last word of the author's name, also with initials", () => {
    expect(makeCiteKey({ authors: ["G. Kucsko"], year: 2013, title: "Thermometry" }, "x")).toBe("kucsko2013thermometry");
  });

  it("leaves out a missing author or year", () => {
    expect(makeCiteKey({ year: 2017, title: "Attention" }, "x")).toBe("2017attention");
    expect(makeCiteKey({ authors: ["Ann Lee"], title: "Attention" }, "x")).toBe("leeattention");
  });

  it("falls back to the given title when the metadata has none", () => {
    expect(makeCiteKey({ authors: ["Ann Lee"], year: 2020 }, "Fallback Words")).toBe("lee2020fallback");
    expect(makeCiteKey({}, "On Growth and Form")).toBe("growth");
  });

  it("falls back to a timestamp key when nothing is usable", () => {
    expect(makeCiteKey({}, "")).toMatch(/^paper\d+$/);
  });
});

describe("uniqueCiteKey", () => {
  it("returns the key when it is free", () => {
    expect(uniqueCiteKey("vaswani2017attention", new Set())).toBe("vaswani2017attention");
    expect(uniqueCiteKey("vaswani2017attention", new Set(["other"]))).toBe("vaswani2017attention");
  });

  it("appends a, b, c… when taken", () => {
    expect(uniqueCiteKey("key", new Set(["key"]))).toBe("keya");
    expect(uniqueCiteKey("key", new Set(["key", "keya"]))).toBe("keyb");
    expect(uniqueCiteKey("key", new Set(["key", "keya", "keyb", "keyc"]))).toBe("keyd");
  });

  it("compares case-insensitively in both directions and keeps the base's casing", () => {
    expect(uniqueCiteKey("Key", new Set(["key"]))).toBe("Keya");
    expect(uniqueCiteKey("key", new Set(["KEY"]))).toBe("keya");
    expect(uniqueCiteKey("key", new Set(["key", "KEYA"]))).toBe("keyb");
  });

  it("continues with two letters after z", () => {
    const taken = new Set(["key"]);
    for (const c of "abcdefghijklmnopqrstuvwxyz") { taken.add(`key${c}`); }
    expect(uniqueCiteKey("key", taken)).toBe("keyaa");
  });
});

describe("claimCiteKey", () => {
  it("returns the base when no id and no folder uses it", async () => {
    expect(await claimCiteKey("key", ["other"], async () => false)).toBe("key");
  });

  it("skips a taken id, whatever its casing", async () => {
    expect(await claimCiteKey("key", ["KEY"], async () => false)).toBe("keya");
  });

  it("skips a key whose folder exists on disk and asks only for candidates", async () => {
    const asked: string[] = [];
    const onDisk = new Set(["key", "keya"]);
    const key = await claimCiteKey("key", [], async (candidate) => { asked.push(candidate); return onDisk.has(candidate); });
    expect(key).toBe("keyb");
    expect(asked).toEqual(["key", "keya", "keyb"]);
  });

  it("combines taken ids and folders on disk", async () => {
    expect(await claimCiteKey("key", ["key"], async (candidate) => candidate === "keya")).toBe("keyb");
  });
});
