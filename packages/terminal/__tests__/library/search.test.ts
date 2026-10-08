import type { PaperRecord } from "@labshelf/core";

import { isEmptyQuery, matchPaper, parseQuery, searchDoc, tokenize } from "../../src/library/search";

function rec(overrides: Partial<PaperRecord> = {}): PaperRecord {
  return { id: "p1", title: "Untitled", path: "/lib/papers/p1", citeKey: "p1", status: "unread", hasPdf: true, ...overrides };
}

/** Score of one record against one query string. */
function score(record: PaperRecord, query: string, annotationText = ""): number {
  return matchPaper(record, searchDoc(record, annotationText), parseQuery(query));
}

describe("tokenize", () => {
  it("splits on whitespace", () => {
    expect(tokenize("attention   transformer\tbert")).toEqual(["attention", "transformer", "bert"]);
  });

  it("keeps a quoted phrase together, without the quotes", () => {
    expect(tokenize('"is all you need" bert')).toEqual(["is all you need", "bert"]);
  });

  it("keeps the - and key: prefixes in front of a quoted phrase", () => {
    expect(tokenize('-"bad phrase" ok')).toEqual(["-bad phrase", "ok"]);
    expect(tokenize('author:"ashish vaswani"')).toEqual(["author:ashish vaswani"]);
  });

  it("accepts an unterminated quote", () => {
    expect(tokenize('"is all you')).toEqual(["is all you"]);
  });

  it("returns nothing for blank input and drops empty phrases", () => {
    expect(tokenize("")).toEqual([]);
    expect(tokenize("   ")).toEqual([]);
    expect(tokenize('""')).toEqual([]);
  });
});

describe("parseQuery", () => {
  it("collects plain words as folded terms", () => {
    expect(parseQuery("Attention Transformer").terms).toEqual(["attention", "transformer"]);
    expect(parseQuery("SCHRÖDINGER").terms).toEqual(["schrodinger"]);
  });

  it("keeps a quoted phrase as one term", () => {
    expect(parseQuery('"All You Need" bert').terms).toEqual(["all you need", "bert"]);
  });

  it("treats -word as an exclusion", () => {
    const q = parseQuery("transformer -Survey -review");
    expect(q.terms).toEqual(["transformer"]);
    expect(q.excluded).toEqual(["survey", "review"]);
  });

  it("treats a lone dash or hash as an ordinary term", () => {
    expect(parseQuery("-").terms).toEqual(["-"]);
    expect(parseQuery("#").terms).toEqual(["#"]);
  });

  it.each([["tag:NLP"], ["t:nlp"], ["#nlp"], ["#NLP"]])("reads %s as the tag nlp", (query) => {
    const q = parseQuery(query);
    expect(q.tags).toEqual(["nlp"]);
    expect(q.terms).toEqual([]);
  });

  it.each([
    ["status:reading", "reading"], ["is:unread", "unread"], ["s:done", "done"],
    ["status:r", "reading"], ["is:u", "unread"], ["is:d", "done"],
    ["status:new", "unread"], ["status:read", "done"], ["IS:DONE", "done"], ["status:Reading", "reading"],
  ])("reads %s as status %s", (query, status) => {
    expect(parseQuery(query).statuses).toEqual([status]);
  });

  it("collects several statuses", () => {
    expect(parseQuery("is:u is:r").statuses).toEqual(["unread", "reading"]);
  });

  it("keeps an unknown status word as a plain term", () => {
    const q = parseQuery("status:bogus");
    expect(q.statuses).toEqual([]);
    expect(q.terms).toEqual(["status:bogus"]);
  });

  describe("year", () => {
    it("exact year sets both bounds", () => {
      const q = parseQuery("year:2017");
      expect([q.yearMin, q.yearMax]).toEqual([2017, 2017]);
    });

    it("range sets both bounds", () => {
      const q = parseQuery("year:2015..2020");
      expect([q.yearMin, q.yearMax]).toEqual([2015, 2020]);
    });

    it("open-ended ranges set one bound", () => {
      expect(parseQuery("year:2015..")).toMatchObject({ yearMin: 2015 });
      expect(parseQuery("year:2015..").yearMax).toBeUndefined();
      expect(parseQuery("year:..2020")).toMatchObject({ yearMax: 2020 });
      expect(parseQuery("year:..2020").yearMin).toBeUndefined();
    });

    it("> and < are exclusive", () => {
      expect(parseQuery("year:>2018").yearMin).toBe(2019);
      expect(parseQuery("year:<2000").yearMax).toBe(1999);
    });

    it(">= and <= are inclusive", () => {
      expect(parseQuery("year:>=2018").yearMin).toBe(2018);
      expect(parseQuery("year:<=2000").yearMax).toBe(2000);
    });

    it("accepts the y: shorthand", () => {
      expect(parseQuery("y:2020")).toMatchObject({ yearMin: 2020, yearMax: 2020 });
    });

    it("combines a lower and an upper comparison", () => {
      const q = parseQuery("year:>=2010 year:<2020");
      expect([q.yearMin, q.yearMax]).toEqual([2010, 2019]);
    });

    it("keeps an unparseable year as a plain term", () => {
      for (const bad of ["year:abc", "year:99", "year:20177"]) {
        const q = parseQuery(bad);
        expect(q.yearMin).toBeUndefined();
        expect(q.terms).toEqual([bad]);
      }
    });
  });

  it.each([["author:vaswani"], ["au:Vaswani"], ["a:VASWANI"]])("reads %s as an author filter", (query) => {
    expect(parseQuery(query).authors).toEqual(["vaswani"]);
  });

  it("folds accents in author filters and keeps a quoted full name", () => {
    expect(parseQuery("author:Müller").authors).toEqual(["muller"]);
    expect(parseQuery('au:"ashish vaswani"').authors).toEqual(["ashish vaswani"]);
  });

  it("reads has: and no: conditions, lower-cased", () => {
    const q = parseQuery("has:PDF no:note has:doi");
    expect(q.has).toEqual(["pdf", "doi"]);
    expect(q.missing).toEqual(["note"]);
  });

  it("keeps key: tokens with an empty value or an unknown key as plain terms", () => {
    expect(parseQuery("author:").terms).toEqual(["author:"]);
    expect(parseQuery("foo:bar").terms).toEqual(["foo:bar"]);
  });

  it("parses a mixed query", () => {
    const q = parseQuery('transformer "self attention" -survey tag:nlp #vision is:r year:2015..2020 au:vaswani has:pdf no:note');
    expect(q).toEqual({
      terms: ["transformer", "self attention"],
      excluded: ["survey"],
      tags: ["nlp", "vision"],
      authors: ["vaswani"],
      statuses: ["reading"],
      yearMin: 2015,
      yearMax: 2020,
      has: ["pdf"],
      missing: ["note"],
    });
  });
});

describe("isEmptyQuery", () => {
  it.each(["", "   ", "\t"])("is true for %j", (query) => {
    expect(isEmptyQuery(parseQuery(query))).toBe(true);
  });

  it.each([
    "word", '"a phrase"', "-word", "tag:x", "#x", "status:done", "year:2020", "year:>2000", "year:..2000",
    "author:x", "has:pdf", "no:pdf",
  ])("is false for %j", (query) => {
    expect(isEmptyQuery(parseQuery(query))).toBe(false);
  });
});

describe("matchPaper: terms and ranking", () => {
  it("returns 0 when the paper does not match, a positive rank when it does", () => {
    const paper = rec({ title: "Attention Is All You Need" });
    expect(score(paper, "convolution")).toBe(0);
    expect(score(paper, "attention")).toBeGreaterThan(0);
  });

  it("matches an empty query with the base rank (callers skip empty queries before calling)", () => {
    expect(score(rec(), "")).toBe(1);
  });

  it("ranks title hits above author hits above everything else", () => {
    const inTitle = rec({ id: "t", title: "BERT: Pre-training of Deep Bidirectional Transformers" });
    const inAuthors = rec({ id: "a", title: "Language models", authors: ["Bert Smith"] });
    const inRest = rec({ id: "r", title: "Language models", note: "reproduce the bert baseline" });
    const nowhere = rec({ id: "n", title: "Language models" });

    expect(score(inTitle, "bert")).toBeGreaterThan(score(inAuthors, "bert"));
    expect(score(inAuthors, "bert")).toBeGreaterThan(score(inRest, "bert"));
    expect(score(inRest, "bert")).toBeGreaterThan(0);
    expect(score(nowhere, "bert")).toBe(0);
  });

  it("ranks a title that starts with the term above one that merely contains it", () => {
    const starts = rec({ title: "Transformers in vision" });
    const contains = rec({ title: "Vision transformers" });
    expect(score(starts, "transformers")).toBeGreaterThan(score(contains, "transformers"));
  });

  it("requires every term, each in any field", () => {
    const paper = rec({ title: "Attention Is All You Need", authors: ["Ashish Vaswani"], note: "revisit multi-head part" });
    expect(score(paper, "attention vaswani")).toBeGreaterThan(0);
    expect(score(paper, "attention multi-head")).toBeGreaterThan(0);
    expect(score(paper, "attention nonsense")).toBe(0);
  });

  it("scores more matching terms higher", () => {
    const paper = rec({ title: "Attention Is All You Need", authors: ["Ashish Vaswani"] });
    expect(score(paper, "attention vaswani")).toBeGreaterThan(score(paper, "attention"));
  });

  it("matches a quoted phrase only as a contiguous phrase", () => {
    const paper = rec({ title: "Attention Is All You Need" });
    expect(score(paper, '"all you need"')).toBeGreaterThan(0);
    expect(score(paper, '"need you all"')).toBe(0);
  });

  it("is case- and accent-insensitive on both sides", () => {
    const paper = rec({ title: "Schrödinger's Cat", authors: ["José Müller"] });
    expect(score(paper, "schrodinger")).toBeGreaterThan(0);
    expect(score(paper, "SCHRÖDINGER")).toBeGreaterThan(0);
    expect(score(paper, "schrödinger")).toBeGreaterThan(0);
    expect(score(paper, "jose muller")).toBeGreaterThan(0);
    expect(score(paper, "au:JOSE")).toBeGreaterThan(0);
  });

  it("searches id, cite key, journal, publisher, doi, url, summary, note, year and keywords", () => {
    const paper = rec({
      id: "vaswani2017attention", citeKey: "vaswani2017attention", title: "T", journal: "NeurIPS Proceedings",
      publisher: "Curran", doi: "10.5555/3295222", url: "https://arxiv.org/abs/1706.03762", summary: "We propose the Transformer",
      note: "my reading note", year: 2017, keywords: ["sequence transduction"], tags: ["nlp"],
    });
    for (const query of [
      "vaswani2017attention", "neurips", "curran", "10.5555/3295222", "1706.03762", "propose", "reading note",
      "2017", "transduction", "nlp",
    ]) {
      expect(score(paper, query)).toBeGreaterThan(0);
    }
  });

  it("finds a paper through its annotation text", () => {
    const paper = rec({ title: "Unrelated title" });
    expect(score(paper, "entanglement")).toBe(0);
    expect(score(paper, "entanglement", "a highlighted passage about quantum entanglement")).toBeGreaterThan(0);
  });
});

describe("matchPaper: operators", () => {
  it("excludes a paper containing a -word anywhere in title, authors or the rest", () => {
    const survey = rec({ title: "A Survey of Transformers" });
    const byAuthor = rec({ title: "Transformers", authors: ["Survey Author"] });
    const byNote = rec({ title: "Transformers", note: "survey-like overview" });
    const clean = rec({ title: "Transformers" });
    for (const paper of [survey, byAuthor, byNote]) { expect(score(paper, "transformers -survey")).toBe(0); }
    expect(score(clean, "transformers -survey")).toBeGreaterThan(0);
  });

  it("tag: matches by prefix, case-insensitively, and requires every tag", () => {
    const paper = rec({ tags: ["NLP-models", "Vision"] });
    expect(score(paper, "tag:nlp")).toBeGreaterThan(0);
    expect(score(paper, "#NLP")).toBeGreaterThan(0);
    expect(score(paper, "tag:models")).toBe(0);
    expect(score(paper, "tag:nlp tag:vis")).toBeGreaterThan(0);
    expect(score(paper, "tag:nlp tag:rl")).toBe(0);
    expect(score(rec(), "tag:nlp")).toBe(0);
  });

  it("status: matches any of the listed statuses", () => {
    const reading = rec({ status: "reading" });
    const done = rec({ status: "done" });
    const unread = rec({ status: "unread" });
    expect(score(reading, "status:reading")).toBeGreaterThan(0);
    expect(score(done, "status:reading")).toBe(0);
    expect(score(done, "is:r is:d")).toBeGreaterThan(0);
    expect(score(unread, "is:r is:d")).toBe(0);
    expect(score(unread, "is:u")).toBeGreaterThan(0);
  });

  it("year: filters by exact value, range and comparison; papers without a year never match", () => {
    const y2017 = rec({ year: 2017 });
    const noYear = rec();
    expect(score(y2017, "year:2017")).toBeGreaterThan(0);
    expect(score(y2017, "year:2018")).toBe(0);
    expect(score(y2017, "year:2015..2020")).toBeGreaterThan(0);
    expect(score(y2017, "year:2018..2020")).toBe(0);
    expect(score(y2017, "year:2015..")).toBeGreaterThan(0);
    expect(score(y2017, "year:..2016")).toBe(0);
    expect(score(y2017, "year:>2016")).toBeGreaterThan(0);
    expect(score(y2017, "year:>2017")).toBe(0);
    expect(score(y2017, "year:>=2017")).toBeGreaterThan(0);
    expect(score(y2017, "year:<2017")).toBe(0);
    expect(score(y2017, "year:<=2017")).toBeGreaterThan(0);
    expect(score(noYear, "year:2015..2020")).toBe(0);
    expect(score(noYear, "year:<2030")).toBe(0);
    expect(score(noYear, "")).toBeGreaterThan(0);
  });

  it("author: matches a substring of the folded author list and needs every author filter", () => {
    const paper = rec({ authors: ["Ashish Vaswani", "Noam Shazeer"] });
    expect(score(paper, "author:vaswani")).toBeGreaterThan(0);
    expect(score(paper, "au:shaz")).toBeGreaterThan(0);
    expect(score(paper, "au:vaswani au:shazeer")).toBeGreaterThan(0);
    expect(score(paper, "au:vaswani au:hinton")).toBe(0);
    expect(score(rec(), "au:vaswani")).toBe(0);
  });

  it("has:pdf / no:pdf follow hasPdf; an unknown hasPdf counts as present", () => {
    expect(score(rec({ hasPdf: true }), "has:pdf")).toBeGreaterThan(0);
    expect(score(rec({ hasPdf: false }), "has:pdf")).toBe(0);
    expect(score(rec({ hasPdf: false }), "no:pdf")).toBeGreaterThan(0);
    expect(score(rec({ hasPdf: true }), "no:pdf")).toBe(0);
    const { hasPdf: _omit, ...unknown } = rec();
    expect(score(unknown, "has:pdf")).toBeGreaterThan(0);
  });

  it("has:note ignores whitespace-only notes; has:doi, has:tags and has:abstract look at their fields", () => {
    expect(score(rec({ note: "a note" }), "has:note")).toBeGreaterThan(0);
    expect(score(rec({ note: "   " }), "has:note")).toBe(0);
    expect(score(rec(), "no:note")).toBeGreaterThan(0);
    expect(score(rec({ doi: "10.1/x" }), "has:doi")).toBeGreaterThan(0);
    expect(score(rec(), "has:doi")).toBe(0);
    expect(score(rec({ tags: ["x"] }), "has:tags")).toBeGreaterThan(0);
    expect(score(rec({ tags: [] }), "has:tags")).toBe(0);
    expect(score(rec({ summary: "An abstract." }), "has:abstract")).toBeGreaterThan(0);
    expect(score(rec(), "has:abstract")).toBe(0);
  });

  it("combines operators with terms (all must hold)", () => {
    const paper = rec({ title: "Attention Is All You Need", year: 2017, status: "reading", tags: ["nlp"], authors: ["Ashish Vaswani"] });
    expect(score(paper, "attention tag:nlp is:r year:2015..2020 au:vaswani has:pdf")).toBeGreaterThan(0);
    expect(score(paper, "attention tag:nlp is:d year:2015..2020")).toBe(0);
  });
});

describe("searchDoc", () => {
  it("folds title and authors and keeps the folded tags", () => {
    const doc = searchDoc(rec({ title: "Schrödinger", authors: ["José Müller", "Ann Lee"], tags: ["NLP", "Vision"] }));
    expect(doc.title).toBe("schrodinger");
    expect(doc.authors).toBe("jose muller; ann lee");
    expect(doc.tags).toEqual(["nlp", "vision"]);
  });

  it("puts annotation text in the rest of the document", () => {
    expect(searchDoc(rec(), "Highlighted TEXT").rest).toContain("highlighted text");
  });

  it("handles a record without authors, tags or optional fields", () => {
    const doc = searchDoc(rec({ id: "x", citeKey: "x" }));
    expect(doc.authors).toBe("");
    expect(doc.tags).toEqual([]);
    expect(doc.rest).toBe("x\nx");
  });
});

describe("unknown has:/no: values", () => {
  it("treats them as plain words instead of filters that match everything or nothing", () => {
    const q = parseQuery("has:typo no:nonsense");
    expect(q.has).toEqual([]);
    expect(q.missing).toEqual([]);
    expect(q.terms).toEqual(["has:typo", "no:nonsense"]);
  });
});
