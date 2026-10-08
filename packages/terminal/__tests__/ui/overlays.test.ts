import { Screen } from "../../src/tui/screen";
import { stringWidth } from "../../src/tui/text";
import { BINDINGS, keyLabel } from "../../src/ui/keymap";
import {
  drawBox,
  drawField,
  drawOverlay,
  helpRows,
  type ConfirmOverlay,
  type Overlay,
  type PickerItem,
  type PickerOverlay,
  type PromptOverlay,
} from "../../src/ui/overlays";
import { textInput } from "../../src/ui/textInput";
import { theme } from "../../src/ui/theme";

function draw(overlay: Overlay, cols = 100, rows = 30): Screen {
  const screen = new Screen(cols, rows);
  drawOverlay(screen, overlay);
  return screen;
}

function prompt(extra: Partial<PromptOverlay> = {}): PromptOverlay {
  return { kind: "prompt", purpose: "add", title: "Add a paper", input: textInput(""), completions: [], targets: [], ...extra };
}

function confirm(extra: Partial<ConfirmOverlay> = {}): ConfirmOverlay {
  return { kind: "confirm", title: "Move to trash", lines: ["Move it to the trash?"], onYes: jest.fn(), ...extra };
}

function picker(items: PickerItem[], extra: Partial<PickerOverlay> = {}): PickerOverlay {
  return { kind: "picker", title: "Jump to folder", input: textInput(""), items, filtered: items, index: 0, onPick: jest.fn(), ...extra };
}

function items(count: number, label = (i: number) => `Item ${String(i).padStart(2, "0")}`): PickerItem[] {
  return Array.from({ length: count }, (_, i) => ({ id: `id${i}`, label: label(i) }));
}

// Row index of the first row containing the text, or -1.
function rowOf(screen: Screen, needle: string): number {
  for (let y = 0; y < screen.height; y++) {
    if (screen.rowText(y).includes(needle)) { return y; }
  }
  return -1;
}

describe("helpRows", () => {
  const rows = helpRows();

  it("has a header for every group, in order, and a final Query section", () => {
    expect(rows.filter((row) => row.header).map((row) => row.keys)).toEqual([
      "Navigate", "Find", "Select", "Papers", "Copy", "Sort", "App", "Query",
    ]);
  });

  it("starts with the Navigate header", () => {
    expect(rows[0]).toEqual({ keys: "Navigate", desc: "", header: true });
  });

  it("lists each binding as its key label and description", () => {
    expect(rows).toContainEqual({ keys: "j", desc: "Move down" });
    expect(rows).toContainEqual({ keys: "g g", desc: "Go to top" });
    expect(rows).toContainEqual({ keys: "m r", desc: "Mark reading" });
    expect(rows).toContainEqual({ keys: "Space", desc: "Select / unselect" });
    expect(rows).toContainEqual({ keys: "S-Tab", desc: "Previous preview tab" });
    expect(rows).toContainEqual({ keys: "C-d", desc: "Half page down" });
  });

  it("does not list alias bindings", () => {
    const labels = new Set(rows.map((row) => row.keys));
    for (const alias of BINDINGS.filter((binding) => binding.alias)) {
      expect(labels.has(keyLabel(alias.keys))).toBe(false);
    }
    for (const label of ["down", "up", "left", "right", "backspace", "pagedown", "pageup", "home", "end", "f1", "C-c", "C-f", "C-b"]) {
      expect(labels.has(label)).toBe(false);
    }
  });

  it("lists every other binding exactly once", () => {
    const listed = rows.filter((row) => !row.header && row.keys !== "");
    const expected = BINDINGS.filter((binding) => !binding.alias).map((binding) => keyLabel(binding.keys));
    const bindingRows = listed.slice(0, expected.length);
    expect(bindingRows.map((row) => row.keys).sort()).toEqual([...expected].sort());
    expect(new Set(expected).size).toBe(expected.length);
  });

  it("puts each binding under the header of its group", () => {
    const groupOf = new Map(BINDINGS.map((binding) => [keyLabel(binding.keys), binding.group]));
    let current = "";
    for (const row of rows) {
      if (row.header) { current = row.keys; continue; }
      if (row.keys === "" || current === "Query") { continue; }
      expect(groupOf.get(row.keys)).toBe(current);
    }
  });

  it("separates groups with a blank row", () => {
    const headerIndexes = rows.flatMap((row, i) => (row.header && i > 0 ? [i] : []));
    for (const index of headerIndexes) {
      expect(rows[index - 1]).toEqual({ keys: "", desc: "" });
    }
  });

  it("documents the query language", () => {
    const query = rows.slice(rows.findIndex((row) => row.keys === "Query") + 1);
    expect(query.length).toBeGreaterThanOrEqual(5);
    const keys = query.map((row) => row.keys).join("\n");
    expect(keys).toContain("tag:nlp");
    expect(keys).toContain("status:reading");
    expect(keys).toContain("year:2015..2020");
    expect(keys).toContain("author:vaswani");
    expect(keys).toContain("has:pdf");
  });
});

describe("drawBox", () => {
  it("draws a rounded border with the title and returns the inner area", () => {
    const screen = new Screen(20, 8);
    const inner = drawBox(screen, { x: 2, y: 1, w: 10, h: 4 }, "T");
    expect(inner).toEqual({ x: 4, y: 2, w: 6, h: 2 });
    expect(screen.rowText(1)).toContain("╭─ T ────╮");
    expect(screen.rowText(2).slice(2, 12)).toBe("│        │");
    expect(screen.rowText(4).slice(2, 12)).toBe("╰────────╯");
  });

  it("clears whatever was underneath", () => {
    const screen = new Screen(12, 5);
    for (let y = 0; y < 5; y++) { screen.text(0, y, "xxxxxxxxxxxx"); }
    drawBox(screen, { x: 1, y: 1, w: 10, h: 3 }, "");
    expect(screen.rowText(2)).toBe("x│        │x");
    expect(screen.rowText(0)).toBe("xxxxxxxxxxxx");
  });

  it("truncates a long title so it stays inside the border", () => {
    const screen = new Screen(30, 4);
    drawBox(screen, { x: 0, y: 0, w: 14, h: 3 }, "A title that is much too long");
    expect(screen.rowText(0).endsWith("╮")).toBe(false);
    expect(screen.rowText(0).slice(0, 14)).toMatch(/^╭─ .*… ─?╮$/);
  });

  it("draws a border without a title", () => {
    const screen = new Screen(10, 3);
    drawBox(screen, { x: 0, y: 0, w: 10, h: 3 }, "");
    expect(screen.rowText(0)).toBe("╭────────╮");
  });
});

describe("drawField", () => {
  it("draws the value with the character under the cursor reversed", () => {
    const screen = new Screen(12, 1);
    drawField(screen, 0, 0, 10, { value: "abc", cursor: 1 });
    expect(screen.rowText(0).trimEnd()).toBe("abc");
    expect(screen.styleAt(0, 0).reverse).toBeFalsy();
    expect(screen.styleAt(1, 0).reverse).toBe(true);
    expect(screen.styleAt(2, 0).reverse).toBeFalsy();
  });

  it("shows the cursor as a reversed blank after the last character", () => {
    const screen = new Screen(12, 1);
    drawField(screen, 2, 0, 10, textInput("abc"));
    expect(screen.rowText(0).slice(2, 5)).toBe("abc");
    expect(screen.styleAt(5, 0).reverse).toBe(true);
    expect(screen.styleAt(4, 0).reverse).toBeFalsy();
  });

  it("shows the cursor in an empty field", () => {
    const screen = new Screen(6, 1);
    drawField(screen, 0, 0, 6, textInput(""));
    expect(screen.styleAt(0, 0).reverse).toBe(true);
  });

  it("keeps the cursor visible by dropping the start of long text", () => {
    const screen = new Screen(12, 1);
    drawField(screen, 0, 0, 10, textInput("START-0123456789-END"));
    const row = screen.rowText(0);
    expect(row).toContain("END");
    expect(row).not.toContain("START");
  });

  it("never draws beyond its width", () => {
    const screen = new Screen(20, 1);
    drawField(screen, 2, 0, 8, textInput("a very long value that overflows"));
    expect(screen.rowText(0).slice(10).trim()).toBe("");
  });

  it("draws the text after the cursor too", () => {
    const screen = new Screen(12, 1);
    drawField(screen, 0, 0, 10, { value: "hello world", cursor: 5 });
    expect(screen.rowText(0)).toContain("hello world".slice(0, 10));
  });
});

describe("drawOverlay prompt", () => {
  it("shows the title, the typed value and the hint inside a box", () => {
    const screen = draw(prompt({ title: "Add a paper to the library root", input: textInput("10.1/abc"), hint: "PDF path, DOI or arXiv id" }));
    const text = screen.toText();
    expect(text).toContain("Add a paper to the library root");
    expect(text).toContain("10.1/abc");
    expect(text).toContain("PDF path, DOI or arXiv id");
    expect(text).toContain("╭");
    expect(text).toContain("╰");
  });

  it("is centered horizontally", () => {
    const screen = draw(prompt());
    const top = screen.rowText(rowOf(screen, "╭"));
    const left = top.indexOf("╭");
    const rightMargin = 100 - 1 - top.indexOf("╮");
    expect(left).toBeGreaterThan(0);
    expect(left).toBe(rightMargin);
  });

  it("shows the completions under the field, at most eight", () => {
    const completions = Array.from({ length: 12 }, (_, i) => `cand${i}/`);
    const screen = draw(prompt({ completions }));
    const text = screen.toText();
    expect(text).toContain("cand0/");
    expect(text).toContain("cand7/");
    expect(text).not.toContain("cand8/");
  });

  it("draws the cursor at its position in the field", () => {
    const screen = draw(prompt({ input: { value: "abcdef", cursor: 2 } }));
    const y = rowOf(screen, "abcdef");
    const x = screen.rowText(y).indexOf("abcdef");
    expect(screen.styleAt(x + 2, y).reverse).toBe(true);
    expect(screen.styleAt(x + 3, y).reverse).toBeFalsy();
  });

  it("keeps the end of a very long value visible inside the box", () => {
    const value = "START" + "x".repeat(150) + "END";
    const screen = draw(prompt({ input: textInput(value) }));
    const text = screen.toText();
    expect(text).toContain("END");
    expect(text).not.toContain("START");
    const y = rowOf(screen, "END");
    expect(screen.rowText(y).trimEnd().endsWith("│")).toBe(true);
  });

  it("wraps a long hint instead of cutting it", () => {
    const screen = draw(prompt({ hint: `${"hint ".repeat(20)}END` }));
    const hintRows = screen.toText().split("\n").filter((row) => row.includes("hint") || row.includes("END"));
    expect(hintRows.length).toBeGreaterThan(1);
    expect(screen.toText()).toContain("END");
    expect(screen.toText()).not.toContain("…");
  });

  it("keeps every hint line inside the box", () => {
    const screen = draw(prompt({ hint: "word ".repeat(200) }));
    for (const row of screen.toText().split("\n").filter((r) => r.includes("word"))) {
      expect(row.trimEnd()).toMatch(/│$/);
    }
  });

  it("covers what was drawn underneath", () => {
    const screen = new Screen(100, 30);
    for (let y = 0; y < 30; y++) { screen.text(0, y, "#".repeat(100)); }
    drawOverlay(screen, prompt({ title: "T" }));
    const y = rowOf(screen, "│");
    const row = screen.rowText(y);
    const inside = row.slice(row.indexOf("│") + 1, row.lastIndexOf("│"));
    expect(inside).not.toContain("#");
  });

  it("grows with a hint and with completions", () => {
    const heightOf = (overlay: PromptOverlay): number => {
      const screen = draw(overlay);
      return rowOf(screen, "╰") - rowOf(screen, "╭") + 1;
    };
    const plain = heightOf(prompt());
    expect(heightOf(prompt({ hint: "a hint" }))).toBe(plain + 1);
    expect(heightOf(prompt({ completions: ["a/", "b/"] }))).toBe(plain + 3);
  });
});

describe("drawOverlay confirm", () => {
  it("shows the title, the lines and the key hints", () => {
    const screen = draw(confirm({ lines: ['Move "Attention Is All You Need" to the trash?', "The next sync removes it from Drive."] }));
    const text = screen.toText();
    expect(text).toContain("Move to trash");
    expect(text).toContain('Move "Attention Is All You Need" to the trash?');
    expect(text).toContain("The next sync removes it from Drive.");
    expect(text).toContain("y confirm   n / Esc cancel");
  });

  it("only draws and never confirms by itself", () => {
    const onYes = jest.fn();
    draw(confirm({ onYes }));
    expect(onYes).not.toHaveBeenCalled();
  });

  it("truncates a line that is wider than the largest box", () => {
    const screen = draw(confirm({ lines: ["word ".repeat(60)] }));
    const y = rowOf(screen, "word word");
    expect(screen.rowText(y).trimEnd()).toMatch(/…\s*│$/);
  });

  it("widens the box for longer lines, up to a limit", () => {
    const widthOf = (line: string): number => {
      const screen = draw(confirm({ lines: [line] }));
      const top = screen.rowText(rowOf(screen, "╭"));
      return top.indexOf("╮") - top.indexOf("╭") + 1;
    };
    expect(widthOf("short")).toBe(40);
    expect(widthOf("x".repeat(60))).toBe(66);
    expect(widthOf("x".repeat(300))).toBe(80);
  });
});

describe("drawOverlay picker", () => {
  it("shows the title with the number of matches, the query and the items", () => {
    const list = [{ id: "a", label: "ML › Transformers", detail: "12" }, { id: "b", label: "Physics", detail: "3" }];
    const screen = draw(picker(list, { input: textInput("ph") }));
    const text = screen.toText();
    expect(text).toContain("Jump to folder (2)");
    expect(text).toContain("ph");
    expect(text).toContain("ML › Transformers");
    expect(text).toContain("Physics");
  });

  it("right-aligns each item's detail", () => {
    const screen = draw(picker([{ id: "a", label: "Physics", detail: "3" }]));
    const y = rowOf(screen, "Physics");
    expect(screen.rowText(y).trimEnd()).toMatch(/Physics\s+3\s*│$/);
  });

  it("highlights the hovered item only", () => {
    const list = items(5);
    const screen = draw(picker(list, { index: 2 }));
    const x = screen.rowText(rowOf(screen, "Item 00")).indexOf("Item 00");
    for (let i = 0; i < 5; i++) {
      const y = rowOf(screen, `Item 0${i}`);
      expect(screen.styleAt(x, y).reverse === true).toBe(i === 2);
    }
  });

  it("shows only the matches it was given", () => {
    const list = items(5);
    const screen = draw(picker(list, { filtered: [list[3]!], input: textInput("3") }));
    const text = screen.toText();
    expect(text).toContain("Item 03");
    expect(text).not.toContain("Item 01");
    expect(text).toContain("(1)");
  });

  it("says No match when nothing matches", () => {
    const screen = draw(picker(items(3), { filtered: [], input: textInput("zzz") }));
    expect(screen.toText()).toContain("No match");
    expect(screen.toText()).toContain("(0)");
  });

  it("scrolls to keep the hovered item visible in a long list", () => {
    const screen = draw(picker(items(50), { index: 30 }));
    const text = screen.toText();
    expect(text).toContain("Item 30");
    expect(text).not.toContain("Item 00");
    expect(text).not.toContain("Item 49");
    const y = rowOf(screen, "Item 30");
    const x = screen.rowText(y).indexOf("Item 30");
    expect(screen.styleAt(x, y).reverse).toBe(true);
  });

  it("shows the start of a long list when the first item is hovered", () => {
    const text = draw(picker(items(50), { index: 0 })).toText();
    expect(text).toContain("Item 00");
    expect(text).not.toContain("Item 30");
  });

  it("shows the end of a long list when the last item is hovered", () => {
    const text = draw(picker(items(50), { index: 49 })).toText();
    expect(text).toContain("Item 49");
    expect(text).not.toContain("Item 00");
  });

  it("keeps long labels and details inside the box", () => {
    const list = [{ id: "a", label: "L".repeat(200), detail: "D".repeat(200) }];
    const screen = draw(picker(list));
    const y = rowOf(screen, "LLLL");
    expect(screen.rowText(y).trimEnd().endsWith("│")).toBe(true);
  });
});

describe("drawOverlay help", () => {
  it("shows the title and the first group", () => {
    const text = draw({ kind: "help", scroll: 0 }).toText();
    expect(text).toContain("LabShelf keys");
    expect(text).toContain("Navigate");
    expect(text).toContain("Move down");
    expect(text).toContain("Go to top");
  });

  it("does not show later groups before scrolling", () => {
    const text = draw({ kind: "help", scroll: 0 }).toText();
    expect(text).not.toContain("Query");
    expect(text).not.toContain("Mark done");
  });

  it("shows later content after scrolling", () => {
    const scroll = helpRows().findIndex((row) => row.keys === "m d");
    const text = draw({ kind: "help", scroll }).toText();
    expect(text).toContain("Mark done");
    expect(text).not.toContain("Half page down");
  });

  it("stops scrolling at the end and shows the query section", () => {
    const end = draw({ kind: "help", scroll: 100_000 });
    expect(end.toText()).toContain("Query");
    expect(end.toText()).toContain("has:pdf  no:pdf");
    expect(end.toText()).toContain("also has:note, has:doi, has:tags");
    // Every example fits the key column, so no example runs into its description.
    for (const row of helpRows().filter((r) => !r.header)) { expect(row.keys.length).toBeLessThan(22); }
    expect(draw({ kind: "help", scroll: helpRows().length }).toText()).toBe(end.toText());
  });

  it("draws group headers in a different style than key rows", () => {
    const screen = draw({ kind: "help", scroll: 0 });
    const header = rowOf(screen, "Navigate");
    const row = rowOf(screen, "Move down");
    const x = screen.rowText(header).indexOf("Navigate");
    const keyX = screen.rowText(row).indexOf("j");
    expect(screen.styleAt(x, header)).toEqual(theme.popupTitle);
    expect(screen.styleAt(keyX, row)).toEqual(theme.key);
  });

  it("lists keys in a column with the description after it", () => {
    const screen = draw({ kind: "help", scroll: 0 });
    const y = rowOf(screen, "Move down");
    const row = screen.rowText(y);
    expect(row.indexOf("Move down") - row.indexOf("j")).toBe(22);
  });

  it("uses the whole screen height except a margin of two rows", () => {
    const screen = draw({ kind: "help", scroll: 0 }, 100, 30);
    expect(rowOf(screen, "╰") - rowOf(screen, "╭") + 1).toBe(28);
    expect(rowOf(screen, "╭")).toBeLessThanOrEqual(2);
  });

  it("truncates descriptions that do not fit", () => {
    const screen = draw({ kind: "help", scroll: 0 }, 60, 30);
    const y = rowOf(screen, "Search the whole library");
    expect(y).toBeGreaterThan(-1);
    expect(screen.rowText(y).trimEnd()).toMatch(/…\s*│$/);
  });
});

describe("drawOverlay on tiny screens", () => {
  const overlays: Overlay[] = [
    prompt({ title: "A title that is long", hint: "hint", completions: ["a", "b", "c"], input: textInput("value") }),
    confirm({ lines: ["one", "two", "three"] }),
    picker(items(30), { index: 12 }),
    { kind: "help", scroll: 5 },
  ];

  it("never throws, whatever the size", () => {
    for (const overlay of overlays) {
      for (const [cols, rows] of [[1, 1], [4, 3], [20, 6], [30, 10], [60, 12], [200, 60]] as const) {
        expect(() => draw(overlay, cols, rows)).not.toThrow();
      }
    }
  });

  it("keeps every row exactly as wide as the screen", () => {
    for (const overlay of overlays) {
      const screen = draw(overlay, 30, 10);
      for (let y = 0; y < screen.height; y++) {
        expect(stringWidth(screen.rowText(y))).toBe(30);
      }
    }
  });
});

describe("drawField regressions", () => {
  it("draws the whole emoji under the cursor, never half a surrogate pair", () => {
    const screen = new Screen(10, 1);
    drawField(screen, 0, 0, 10, { value: "a😀b", cursor: 1 });
    expect(screen.rowText(0)).toContain("😀");
    expect(screen.rowText(0)).not.toContain("�");
    expect(screen.rowText(0).startsWith("a😀b")).toBe(true);
  });
});
