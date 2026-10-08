import { mergeStyle, Screen, sgr, styleId } from "../../src/tui/screen";
import { stringWidth } from "../../src/tui/text";

// Every escape sequence the diff is allowed to emit: cursor moves and SGR.
const LEGIT_SEQUENCE = /\x1b\[\d+;\d+H|\x1b\[[\d;]*m/g;

function stripLegit(output: string): string {
  return output.replace(LEGIT_SEQUENCE, "");
}

describe("Screen basics", () => {
  it("starts blank", () => {
    const screen = new Screen(5, 2);
    expect(screen.width).toBe(5);
    expect(screen.height).toBe(2);
    expect(screen.rowText(0)).toBe("     ");
    expect(screen.toText()).toBe("\n");
  });

  it("draws text and returns the number of cells written", () => {
    const screen = new Screen(10, 2);
    expect(screen.text(2, 1, "abc")).toBe(3);
    expect(screen.rowText(1)).toBe("  abc     ");
    expect(screen.toText()).toBe("\n  abc");
  });

  it("returns 0 and draws nothing for rows or columns outside the screen", () => {
    const screen = new Screen(5, 2);
    expect(screen.text(0, -1, "x")).toBe(0);
    expect(screen.text(0, 2, "x")).toBe(0);
    expect(screen.text(5, 0, "x")).toBe(0);
    expect(screen.text(9, 1, "x")).toBe(0);
    expect(screen.toText()).toBe("\n");
  });

  it("joins rows with newlines and trims trailing spaces of each row", () => {
    const screen = new Screen(8, 3);
    screen.text(0, 0, "top  ");
    screen.text(3, 2, "end");
    expect(screen.toText()).toBe("top\n\n   end");
  });

  it("handles an empty screen", () => {
    const screen = new Screen(0, 0);
    expect(screen.toText()).toBe("");
    expect(screen.diff(undefined)).toBe("");
  });

  it("stores the style of each drawn cell", () => {
    const screen = new Screen(6, 1);
    screen.text(1, 0, "ab", { fg: 1, bold: true });
    expect(screen.styleAt(0, 0)).toEqual({});
    expect(screen.styleAt(1, 0)).toEqual({ fg: 1, bold: true });
    expect(screen.styleAt(2, 0)).toEqual({ fg: 1, bold: true });
    expect(screen.styleAt(3, 0)).toEqual({});
  });

  it("replaces the style of a cell when it is drawn over", () => {
    const screen = new Screen(4, 1);
    screen.text(0, 0, "abcd", { fg: 2 });
    screen.text(1, 0, "X", { reverse: true });
    expect(screen.rowText(0)).toBe("aXcd");
    expect(screen.styleAt(0, 0)).toEqual({ fg: 2 });
    expect(screen.styleAt(1, 0)).toEqual({ reverse: true });
    expect(screen.styleAt(2, 0)).toEqual({ fg: 2 });
  });
});

describe("Screen clipping", () => {
  it("clips text at the right edge", () => {
    const screen = new Screen(5, 1);
    expect(screen.text(3, 0, "abcdef")).toBe(2);
    expect(screen.rowText(0)).toBe("   ab");
  });

  it("clips text to maxWidth", () => {
    const screen = new Screen(10, 1);
    expect(screen.text(1, 0, "abcdef", undefined, 3)).toBe(3);
    expect(screen.rowText(0)).toBe(" abc      ");
  });

  it("draws only the visible part of text that starts left of the screen", () => {
    const screen = new Screen(4, 1);
    screen.text(-2, 0, "abcd");
    expect(screen.rowText(0)).toBe("cd  ");
  });

  it("leaves a blank instead of spilling a wide character over the edge", () => {
    const screen = new Screen(5, 1);
    expect(screen.text(4, 0, "日")).toBe(1);
    expect(screen.toText()).toBe("");
    expect(screen.rowText(0)).toBe("     ");
  });

  it("leaves a blank when a wide character does not fit in maxWidth", () => {
    const screen = new Screen(10, 1);
    expect(screen.text(0, 0, "日本", undefined, 3)).toBe(3);
    expect(screen.rowText(0)).toBe("日" + " ".repeat(8));
    expect(stringWidth(screen.rowText(0))).toBe(10);
    expect(screen.toText()).toBe("日");
  });

  it("keeps every row exactly as wide as the screen after drawing wide text", () => {
    const screen = new Screen(9, 2);
    screen.text(0, 0, "日本語日");
    screen.text(3, 1, "a日b日c日d");
    for (let y = 0; y < 2; y++) {
      expect(stringWidth(screen.rowText(y))).toBe(9);
    }
  });
});

describe("Screen.fill", () => {
  it("fills a rectangle with a style", () => {
    const screen = new Screen(6, 3);
    screen.fill(1, 1, 3, 2, { bg: 4 });
    expect(screen.styleAt(1, 1)).toEqual({ bg: 4 });
    expect(screen.styleAt(3, 2)).toEqual({ bg: 4 });
    expect(screen.styleAt(0, 1)).toEqual({});
    expect(screen.styleAt(4, 1)).toEqual({});
    expect(screen.styleAt(1, 0)).toEqual({});
  });

  it("fills with a custom character", () => {
    const screen = new Screen(5, 2);
    screen.fill(1, 0, 3, 1, undefined, "─");
    expect(screen.toText()).toBe(" ───\n");
  });

  it("clears text that was underneath", () => {
    const screen = new Screen(8, 1);
    screen.text(0, 0, "abcdefgh");
    screen.fill(2, 0, 3, 1);
    expect(screen.rowText(0)).toBe("ab   fgh");
  });

  it("clips to the screen without throwing", () => {
    const screen = new Screen(4, 2);
    expect(() => screen.fill(-2, -2, 10, 10, { bg: 1 }, "#")).not.toThrow();
    expect(screen.toText()).toBe("####\n####");
    expect(() => screen.fill(10, 10, 3, 3, undefined, "x")).not.toThrow();
    expect(screen.toText()).toBe("####\n####");
  });

  it("blanks the other half of a wide character it overwrites", () => {
    const screen = new Screen(6, 1);
    screen.text(0, 0, "日本語");
    screen.fill(1, 0, 1, 1, undefined, "x");
    expect(screen.rowText(0)).toBe(" x本語");
    expect(stringWidth(screen.rowText(0))).toBe(6);
  });
});

describe("Screen wide characters", () => {
  it("draws a wide character over two cells", () => {
    const screen = new Screen(5, 1);
    expect(screen.text(1, 0, "日")).toBe(2);
    expect(screen.toText()).toBe(" 日");
    expect(stringWidth(screen.rowText(0))).toBe(5);
  });

  it("turns the left half into a blank when its right half is overwritten", () => {
    const screen = new Screen(5, 1);
    screen.text(0, 0, "日");
    screen.text(1, 0, "x");
    expect(screen.rowText(0)).toBe(" x   ");
  });

  it("turns the right half into a blank when its left half is overwritten", () => {
    const screen = new Screen(5, 1);
    screen.text(0, 0, "日");
    screen.text(0, 0, "x");
    expect(screen.rowText(0)).toBe("x    ");
  });

  it("replaces a wide character with another one at the same position", () => {
    const screen = new Screen(5, 1);
    screen.text(0, 0, "日");
    screen.text(0, 0, "本");
    expect(screen.rowText(0)).toBe("本   ");
    expect(stringWidth(screen.rowText(0))).toBe(5);
  });

  it("blanks the left half when a wide character is drawn one cell to the right", () => {
    const screen = new Screen(5, 1);
    screen.text(0, 0, "日");
    screen.text(1, 0, "本");
    expect(screen.rowText(0)).toBe(" 本  ");
    expect(stringWidth(screen.rowText(0))).toBe(5);
  });

  it("gives both halves of a wide character the same style", () => {
    const screen = new Screen(4, 1);
    screen.text(0, 0, "日", { fg: 3 });
    expect(screen.styleAt(0, 0)).toEqual({ fg: 3 });
    expect(screen.styleAt(1, 0)).toEqual({ fg: 3 });
  });

  it("keeps an emoji cluster in one cell pair", () => {
    const screen = new Screen(6, 1);
    screen.text(0, 0, "a😀b");
    expect(screen.toText()).toBe("a😀b");
    expect(stringWidth(screen.rowText(0))).toBe(6);
  });

  it("draws a combining accent together with its base letter and skips zero-width characters", () => {
    const screen = new Screen(6, 1);
    expect(screen.text(0, 0, "é​x")).toBe(2);
    expect(screen.rowText(0)).toBe("éx    ");
  });
});

describe("styleId", () => {
  it("returns 0 for no style", () => {
    expect(styleId(undefined)).toBe(0);
  });

  it("returns the same id for equal styles and different ids for different ones", () => {
    const a = styleId({ fg: 1, bold: true });
    expect(styleId({ fg: 1, bold: true })).toBe(a);
    expect(styleId({ bold: true, fg: 1 })).toBe(a);
    expect(styleId({ fg: 2, bold: true })).not.toBe(a);
    expect(styleId({ fg: 1 })).not.toBe(a);
  });

  it("treats an explicit false attribute like an absent one", () => {
    expect(styleId({ bold: false, fg: 4 })).toBe(styleId({ fg: 4 }));
  });

  it("distinguishes a palette color from a hex color and foreground from background", () => {
    expect(styleId({ fg: 1 })).not.toBe(styleId({ bg: 1 }));
    expect(styleId({ fg: "#ff0000" })).not.toBe(styleId({ fg: 1 }));
    expect(styleId({ fg: "#ff0000" })).toBe(styleId({ fg: "#ff0000" }));
  });

  it("does not let later changes to the style object affect stored cells", () => {
    const style = { fg: 5 };
    const screen = new Screen(2, 1);
    screen.text(0, 0, "a", style);
    style.fg = 6;
    expect(screen.styleAt(0, 0)).toEqual({ fg: 5 });
  });
});

describe("mergeStyle", () => {
  it("lets the second style win", () => {
    expect(mergeStyle({ fg: 1, bold: true }, { fg: 2, dim: true })).toEqual({ fg: 2, bold: true, dim: true });
  });

  it("accepts missing styles", () => {
    expect(mergeStyle(undefined, undefined)).toEqual({});
    expect(mergeStyle({ fg: 1 }, undefined)).toEqual({ fg: 1 });
    expect(mergeStyle(undefined, { bg: 2 })).toEqual({ bg: 2 });
  });

  it("does not modify its inputs", () => {
    const base = { fg: 1 };
    mergeStyle(base, { fg: 2 });
    expect(base).toEqual({ fg: 1 });
  });
});

describe("sgr", () => {
  it("resets for the default style", () => {
    expect(sgr(0)).toBe("\x1b[0m");
  });

  it("emits attributes in a fixed order", () => {
    const id = styleId({ reverse: true, underline: true, italic: true, dim: true, bold: true });
    expect(sgr(id)).toBe("\x1b[0;1;2;3;4;7m");
  });

  it("maps the 16 theme colors to the classic SGR codes", () => {
    expect(sgr(styleId({ fg: 1 }))).toBe("\x1b[0;31m");
    expect(sgr(styleId({ bg: 2 }))).toBe("\x1b[0;42m");
    expect(sgr(styleId({ fg: 9 }))).toBe("\x1b[0;91m");
    expect(sgr(styleId({ bg: 12 }))).toBe("\x1b[0;104m");
  });

  it("uses the 256-color palette for indexes from 16", () => {
    expect(sgr(styleId({ fg: 200 }))).toBe("\x1b[0;38;5;200m");
    expect(sgr(styleId({ bg: 16 }))).toBe("\x1b[0;48;5;16m");
  });

  it("uses truecolor for hex colors", () => {
    expect(sgr(styleId({ fg: "#ff8000", bg: "#000102" }))).toBe("\x1b[0;38;2;255;128;0;48;2;0;1;2m");
  });

  it("combines attributes with foreground and background", () => {
    expect(sgr(styleId({ bold: true, fg: 4, bg: 7 }))).toBe("\x1b[0;1;34;47m");
  });
});

describe("Screen.diff", () => {
  it("writes every cell when there is no previous frame", () => {
    const screen = new Screen(3, 1);
    screen.text(0, 0, "ab");
    expect(screen.diff(undefined)).toBe("\x1b[1;1H\x1b[0mab \x1b[0m");
  });

  it("positions the cursor at the start of each row of a full frame", () => {
    const screen = new Screen(2, 2);
    screen.text(0, 0, "ab");
    screen.text(0, 1, "cd");
    expect(screen.diff(undefined)).toBe("\x1b[1;1H\x1b[0mab\x1b[2;1Hcd\x1b[0m");
  });

  it("returns an empty string when nothing changed", () => {
    const previous = new Screen(4, 2);
    previous.text(0, 0, "same", { fg: 2 });
    const next = new Screen(4, 2);
    next.text(0, 0, "same", { fg: 2 });
    expect(next.diff(previous)).toBe("");
  });

  it("writes only the cells that changed", () => {
    const previous = new Screen(5, 2);
    previous.text(0, 0, "hello");
    previous.text(0, 1, "world");
    const next = new Screen(5, 2);
    next.text(0, 0, "hello");
    next.text(0, 1, "wxrld");
    expect(next.diff(previous)).toBe("\x1b[2;2H\x1b[0mx\x1b[0m");
  });

  it("moves the cursor once for adjacent changed cells and again after a gap", () => {
    const previous = new Screen(8, 1);
    previous.text(0, 0, "abcdefgh");
    const next = new Screen(8, 1);
    next.text(0, 0, "XYcdeFgh");
    expect(next.diff(previous)).toBe("\x1b[1;1H\x1b[0mXY\x1b[1;6HF\x1b[0m");
  });

  it("emits a new SGR sequence only when the style changes between written cells", () => {
    const previous = new Screen(4, 1);
    const next = new Screen(4, 1);
    next.text(0, 0, "ab", { fg: 1 });
    next.text(2, 0, "cd", { fg: 2 });
    expect(next.diff(previous)).toBe("\x1b[1;1H\x1b[0;31mab\x1b[0;32mcd\x1b[0m");
  });

  it("redraws a cell whose style changed but whose character did not", () => {
    const previous = new Screen(3, 1);
    previous.text(0, 0, "abc");
    const next = new Screen(3, 1);
    next.text(0, 0, "abc");
    next.text(1, 0, "b", { reverse: true });
    expect(next.diff(previous)).toBe("\x1b[1;2H\x1b[0;7mb\x1b[0m");
  });

  it("writes the whole frame again after a resize", () => {
    const previous = new Screen(3, 1);
    const next = new Screen(4, 1);
    next.text(0, 0, "abcd");
    expect(next.diff(previous)).toBe("\x1b[1;1H\x1b[0mabcd\x1b[0m");
    const taller = new Screen(4, 2);
    expect(taller.diff(next)).toContain("\x1b[2;1H");
  });

  it("writes a wide character once and skips its right half", () => {
    const screen = new Screen(4, 1);
    screen.text(0, 0, "日x");
    expect(screen.diff(undefined)).toBe("\x1b[1;1H\x1b[0m日x \x1b[0m");
  });

  it("redraws a wide character when only its right half changed", () => {
    const previous = new Screen(4, 1);
    previous.text(0, 0, "日");
    const next = new Screen(4, 1);
    next.text(0, 0, "日", { fg: 1 });
    const output = next.diff(previous);
    expect(output).toContain("日");
    expect(output).toContain("\x1b[0;31m");
  });

  it("repairs the cells next to a wide character that replaced two narrow ones", () => {
    const previous = new Screen(4, 1);
    previous.text(0, 0, "abcd");
    const next = new Screen(4, 1);
    next.text(0, 0, "日cd");
    expect(next.diff(previous)).toBe("\x1b[1;1H\x1b[0m日\x1b[0m");
  });

  it("starts every diff from a known pen, so the first written cell sets its style", () => {
    const previous = new Screen(2, 1);
    const next = new Screen(2, 1);
    next.text(1, 0, "x", { bold: true });
    expect(next.diff(previous)).toBe("\x1b[1;2H\x1b[0;1mx\x1b[0m");
  });

  it("round-trips: applying a diff to the previous frame yields the next frame's text", () => {
    // A tiny terminal emulator that understands only what diff emits.
    function applyOutput(output: string, base: Screen): string[] {
      const rows = Array.from({ length: base.height }, (_, y) => [...base.rowText(y).padEnd(base.width)]);
      let row = 0;
      let col = 0;
      for (const token of output.split(/(\x1b\[[\d;]*[Hm])/)) {
        const move = /^\x1b\[(\d+);(\d+)H$/.exec(token);
        if (move) { row = Number(move[1]) - 1; col = Number(move[2]) - 1; continue; }
        if (token.startsWith("\x1b[")) { continue; }
        for (const ch of token) {
          rows[row]![col] = ch;
          col += stringWidth(ch);
        }
      }
      return rows.map((r) => r.join("").trimEnd());
    }
    const previous = new Screen(12, 3);
    previous.text(0, 0, "Papers");
    previous.text(0, 1, "alpha beta");
    const next = new Screen(12, 3);
    next.text(0, 0, "Papers", { bold: true });
    next.text(0, 1, "alpha gamma");
    next.text(0, 2, "last row");
    const result = applyOutput(next.diff(previous), previous);
    expect(result.join("\n")).toBe(next.toText());
  });
});

describe("Screen output safety", () => {
  it("never lets a title with a clear-screen sequence reach the output raw", () => {
    const screen = new Screen(30, 1);
    screen.text(0, 0, "Evil \x1b[2J title");
    const output = screen.diff(undefined);
    expect(output).not.toContain("\x1b[2J");
    expect(stripLegit(output)).not.toContain("\x1b");
    expect(screen.toText()).toContain("Evil �[2J title");
  });

  it("neutralizes OSC, C1 and other control characters", () => {
    const hostile = [
      "\x1b]0;pwned\x07",
      "\x1b]52;c;ZXZpbA==\x07",
      "\x9b2J",
      "\x07bell",
      "line1\rline2\nline3",
      "nul\x00byte",
      "del\x7fchar",
      "\x1bP+q\x1b\\",
    ].join(" | ");
    const screen = new Screen(120, 1);
    screen.text(0, 0, hostile);
    const output = stripLegit(screen.diff(undefined));
    expect(output).not.toMatch(/[\x00-\x08\x0a-\x1f\x7f-\x9f]/);
    expect(screen.toText()).toContain("pwned");
  });

  it("neutralizes controls in text drawn through a maxWidth clip and next to wide characters", () => {
    const screen = new Screen(20, 1);
    screen.text(0, 0, "日\x1b[31m本\x1b[0m", { fg: 2 }, 12);
    const output = stripLegit(screen.diff(undefined));
    expect(output).not.toMatch(/[\x00-\x08\x0a-\x1f\x7f-\x9f]/);
  });

  it("drops bidirectional override characters instead of passing them on", () => {
    const screen = new Screen(10, 1);
    screen.text(0, 0, "a‮b");
    expect(screen.diff(undefined)).not.toContain("‮");
    expect(screen.toText()).toBe("ab");
  });

  it("emits only cursor moves, SGR sequences and visible text", () => {
    const screen = new Screen(20, 2);
    screen.text(0, 0, "Header", { fg: 4, bold: true });
    screen.text(0, 1, "日本語 and \x1b[2J", { dim: true });
    const output = screen.diff(undefined);
    const withoutLegit = stripLegit(output);
    expect(withoutLegit).not.toMatch(/[\x00-\x1f\x7f-\x9f]/);
  });
});

describe("Screen regressions", () => {
  it("blanks the right half of a wide character whose left half a new wide character takes", () => {
    const s = new Screen(6, 1);
    s.text(0, 0, "日日");
    s.text(1, 0, "本");
    expect(stringWidth(s.rowText(0))).toBe(6);
    expect(s.rowText(0).startsWith(" 本 ")).toBe(true);
  });

  it("gives every empty style the default id", () => {
    expect(styleId({})).toBe(0);
    expect(styleId({ bold: false })).toBe(0);
    expect(styleId(undefined)).toBe(0);
  });
});
