import { fit, fold, graphemes, graphemeWidth, sanitizeForTerminal, stringWidth, truncate, wrap } from "../../src/tui/text";

describe("text width helpers", () => {
  it("counts ASCII, accents, CJK and emoji by terminal cells", () => {
    expect(stringWidth("abc")).toBe(3);
    expect(stringWidth("Schrödinger")).toBe(11);
    expect(stringWidth("日本")).toBe(4);
  });

  it("truncates by cells with an ellipsis", () => {
    expect(truncate("Attention Is All You Need", 10)).toBe("Attention…");
    expect(stringWidth(truncate("日本語のタイトル", 5))).toBeLessThanOrEqual(5);
  });

  it("pads to an exact width", () => {
    expect(fit("ab", 4)).toBe("ab  ");
  });

  it("wraps words and hard-breaks long ones", () => {
    expect(wrap("one two three", 7)).toEqual(["one two", "three"]);
    expect(wrap("abcdefghij", 4)).toEqual(["abcd", "efgh", "ij"]);
  });

  it("folds accents and case", () => {
    expect(fold("Lässig")).toBe("lassig");
  });
});

describe("graphemeWidth", () => {
  it("is 1 for printable ASCII and accented letters", () => {
    expect(graphemeWidth("a")).toBe(1);
    expect(graphemeWidth(" ")).toBe(1);
    expect(graphemeWidth("~")).toBe(1);
    expect(graphemeWidth("é")).toBe(1);
  });

  it("is 2 for CJK, Hangul, fullwidth forms and emoji", () => {
    expect(graphemeWidth("日")).toBe(2);
    expect(graphemeWidth("한")).toBe(2);
    expect(graphemeWidth("Ａ")).toBe(2);
    expect(graphemeWidth("😀")).toBe(2);
  });

  it("is 2 for a narrow symbol followed by the emoji presentation selector", () => {
    expect(graphemeWidth("❤️")).toBe(2);
  });

  it("is 0 for control characters, combining marks and zero-width format characters", () => {
    expect(graphemeWidth("\x1b")).toBe(0);
    expect(graphemeWidth("\x7f")).toBe(0);
    expect(graphemeWidth("́")).toBe(0);
    expect(graphemeWidth("​")).toBe(0);
  });
});

describe("graphemes", () => {
  it("returns one entry per user-perceived character with its width", () => {
    expect(graphemes("a日")).toEqual([{ g: "a", w: 1 }, { g: "日", w: 2 }]);
  });

  it("keeps a base letter and its combining accent together", () => {
    expect(graphemes("é")).toEqual([{ g: "é", w: 1 }]);
  });

  it("keeps an emoji outside the BMP as a single two-cell cluster", () => {
    expect(graphemes("a😀b")).toEqual([{ g: "a", w: 1 }, { g: "😀", w: 2 }, { g: "b", w: 1 }]);
  });

  it("returns nothing for an empty string", () => {
    expect(graphemes("")).toEqual([]);
  });

  it("replaces control characters with a visible placeholder so escape sequences cannot reach the terminal", () => {
    const text = graphemes("a\x1b[2Jb").map((entry) => entry.g).join("");
    expect(text).toBe("a�[2Jb");
    expect(text).not.toContain("\x1b");
  });

  it("replaces C0, DEL and C1 controls alike, each taking one cell", () => {
    for (const control of ["\x00", "\x07", "\x1b", "\x7f", "\x9b"]) {
      expect(graphemes(control)).toEqual([{ g: "�", w: 1 }]);
    }
  });

  it("turns a tab into a single space", () => {
    expect(graphemes("a\tb")).toEqual([{ g: "a", w: 1 }, { g: " ", w: 1 }, { g: "b", w: 1 }]);
  });

  it("treats CRLF as one placeholder cell", () => {
    expect(graphemes("a\r\nb").map((entry) => entry.g)).toEqual(["a", "�", "b"]);
  });

  it("keeps zero-width characters with width 0", () => {
    expect(graphemes("a​b")).toEqual([{ g: "a", w: 1 }, { g: "​", w: 0 }, { g: "b", w: 1 }]);
  });
});

describe("stringWidth", () => {
  it("is 0 for the empty string", () => {
    expect(stringWidth("")).toBe(0);
  });

  it("counts an escape sequence as visible placeholder cells, never as zero-width", () => {
    expect(stringWidth("\x1b[2J")).toBe(4);
  });

  it("counts wide characters as two cells each and ignores combining marks", () => {
    expect(stringWidth("日本語")).toBe(6);
    expect(stringWidth("é")).toBe(1);
    expect(stringWidth("a😀")).toBe(3);
  });
});

describe("truncate edge cases", () => {
  it("returns an empty string for a width of 0 or less", () => {
    expect(truncate("abc", 0)).toBe("");
    expect(truncate("abc", -3)).toBe("");
  });

  it("returns just the ellipsis for a width of 1 when the text is longer", () => {
    expect(truncate("abc", 1)).toBe("…");
    expect(truncate("ab", 1)).toBe("…");
  });

  it("keeps text that already fits in a width of 1", () => {
    expect(truncate("a", 1)).toBe("a");
    expect(truncate("", 1)).toBe("");
  });

  it("leaves text that fits exactly untouched", () => {
    expect(truncate("abcd", 4)).toBe("abcd");
    expect(truncate("日本", 4)).toBe("日本");
  });

  it("never cuts a wide character in half", () => {
    const cut = truncate("日本語", 4);
    expect(cut).toBe("日…");
    expect(stringWidth(cut)).toBeLessThanOrEqual(4);
  });

  it("uses a custom ellipsis and shortens it when the width is smaller than the ellipsis", () => {
    expect(truncate("abcdefgh", 6, "...")).toBe("abc...");
    expect(truncate("abcdefgh", 2, "...")).toBe("..");
  });

  it("accepts an empty ellipsis", () => {
    expect(truncate("abcdef", 3, "")).toBe("abc");
  });

  it("always fits the requested width", () => {
    for (const text of ["Attention Is All You Need", "日本語のタイトル", "a😀b😀c😀d", "éééé"]) {
      for (let width = 0; width <= 12; width++) {
        expect(stringWidth(truncate(text, width))).toBeLessThanOrEqual(width);
      }
    }
  });

  it("replaces control characters in the kept part", () => {
    expect(truncate("a\x1b[2Jbcdef", 5)).toBe("a�[2…");
  });
});

describe("fit", () => {
  it("pads wide text by cells, not by characters", () => {
    expect(fit("日", 4)).toBe("日  ");
  });

  it("truncates text wider than the width", () => {
    expect(fit("Attention Is All", 9)).toBe("Attentio…");
  });

  it("returns an empty string for a width of 0", () => {
    expect(fit("abc", 0)).toBe("");
  });

  it("always produces exactly the requested number of cells", () => {
    for (const text of ["", "ab", "Attention Is All You Need", "日本語", "a😀b"]) {
      for (const width of [1, 2, 5, 9, 20]) {
        expect(stringWidth(fit(text, width))).toBe(width);
      }
    }
  });
});

describe("wrap", () => {
  it("keeps explicit newlines as line breaks", () => {
    expect(wrap("first\nsecond", 20)).toEqual(["first", "second"]);
  });

  it("keeps blank lines between paragraphs, including a trailing one", () => {
    expect(wrap("a\n\nb", 10)).toEqual(["a", "", "b"]);
    expect(wrap("a\n", 10)).toEqual(["a", ""]);
  });

  it("treats CRLF and lone CR as newlines", () => {
    expect(wrap("a\r\nb\rc", 10)).toEqual(["a", "b", "c"]);
  });

  it("wraps each paragraph independently", () => {
    expect(wrap("one two three\nfour five", 7)).toEqual(["one two", "three", "four", "five"]);
  });

  it("returns a single empty line for empty text", () => {
    expect(wrap("", 10)).toEqual([""]);
  });

  it("returns nothing for a width of 0 or less", () => {
    expect(wrap("abc", 0)).toEqual([]);
    expect(wrap("abc", -1)).toEqual([]);
  });

  it("collapses runs of spaces and tabs between words", () => {
    expect(wrap("a   b\tc", 20)).toEqual(["a b c"]);
  });

  it("puts a word on its own line before hard-breaking one that is too long", () => {
    expect(wrap("hi abcdefghij", 4)).toEqual(["hi", "abcd", "efgh", "ij"]);
  });

  it("continues the next word on the last piece of a hard-broken word", () => {
    expect(wrap("abcdefghij k", 4)).toEqual(["abcd", "efgh", "ij k"]);
  });

  it("breaks wide characters by cells", () => {
    expect(wrap("日本語日本語", 4)).toEqual(["日本", "語日", "本語"]);
  });

  it("never produces a line wider than the width", () => {
    const text = "Attention is all you need 日本語のタイトル supercalifragilisticexpialidocious\n\nend";
    for (const width of [4, 7, 12, 30]) {
      for (const line of wrap(text, width)) {
        expect(stringWidth(line)).toBeLessThanOrEqual(width);
      }
    }
  });

  it("does not lose any word", () => {
    const words = "the quick brown fox jumps over the lazy dog".split(" ");
    expect(wrap(words.join(" "), 11).join(" ").split(" ")).toEqual(words);
  });
});

describe("fold", () => {
  it("strips every kind of accent and lowercases", () => {
    expect(fold("Çaglar ÉCOLE naïve")).toBe("caglar ecole naive");
  });

  it("leaves unaccented text only lowercased", () => {
    expect(fold("Attention")).toBe("attention");
  });
});

describe("wrap regressions", () => {
  it("never starts with an empty line when a wide character is wider than the line", () => {
    expect(wrap("日", 1)).toEqual(["日"]);
  });
});

describe("sanitizeForTerminal", () => {
  it("neutralises escape sequences from untrusted metadata but keeps newlines and tabs", () => {
    const evil = "Deep nets\x1b]52;c;ZXZpbA==\x07 and\tmore\nline\x9b2J";
    const safe = sanitizeForTerminal(evil);
    expect(safe).not.toMatch(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/);
    expect(safe).toContain("\t");
    expect(safe).toContain("\n");
    expect(safe.startsWith("Deep nets�]52;c;")).toBe(true);
  });
});
