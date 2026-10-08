import type { InputEvent } from "../../src/tui/input";
import { editText, textInput, type TextInputState } from "../../src/ui/textInput";

const key = (id: string): InputEvent => ({ type: "key", id });
const typed = (text: string): InputEvent => ({ type: "key", id: text === " " ? "space" : text, text });
const paste = (text: string): InputEvent => ({ type: "paste", text });

// Applies events one after the other, failing loudly when one is not an editing key.
function apply(state: TextInputState, ...events: InputEvent[]): TextInputState {
  let current = state;
  for (const event of events) {
    const next = editText(current, event);
    if (!next) { throw new Error(`event was not handled: ${JSON.stringify(event)}`); }
    current = next;
  }
  return current;
}

describe("textInput", () => {
  it("starts empty with the cursor at 0", () => {
    expect(textInput()).toEqual({ value: "", cursor: 0 });
  });

  it("puts the cursor at the end of the initial value", () => {
    expect(textInput("abc")).toEqual({ value: "abc", cursor: 3 });
  });
});

describe("editText insertion", () => {
  it("inserts typed text at the cursor", () => {
    expect(editText({ value: "ac", cursor: 1 }, typed("b"))).toEqual({ value: "abc", cursor: 2 });
  });

  it("appends at the end", () => {
    expect(editText(textInput("ab"), typed("c"))).toEqual({ value: "abc", cursor: 3 });
  });

  it("inserts at the start", () => {
    expect(editText({ value: "bc", cursor: 0 }, typed("a"))).toEqual({ value: "abc", cursor: 1 });
  });

  it("inserts a space from the space key", () => {
    expect(editText(textInput("a"), typed(" "))).toEqual({ value: "a ", cursor: 2 });
  });

  it("inserts a space from a space key event without text", () => {
    expect(editText({ value: "ab", cursor: 1 }, key("space"))).toEqual({ value: "a b", cursor: 2 });
  });

  it("advances the cursor by the length of the inserted text, so an emoji moves it by two code units", () => {
    expect(editText(textInput("a"), typed("😀"))).toEqual({ value: "a😀", cursor: 3 });
  });

  it("types a whole word key by key", () => {
    const result = apply(textInput(), typed("h"), typed("e"), typed("y"), typed(" "), typed("日"));
    expect(result).toEqual({ value: "hey 日", cursor: 5 });
  });

  it("does not modify the state it was given", () => {
    const state = textInput("abc");
    editText(state, typed("d"));
    editText(state, key("backspace"));
    expect(state).toEqual({ value: "abc", cursor: 3 });
  });
});

describe("editText paste", () => {
  it("inserts pasted text at the cursor and moves the cursor after it", () => {
    expect(editText({ value: "ad", cursor: 1 }, paste("bc"))).toEqual({ value: "abcd", cursor: 3 });
  });

  it("collapses newlines into single spaces", () => {
    expect(editText(textInput(), paste("one\ntwo\r\nthree\rfour"))).toEqual({ value: "one two three four", cursor: 18 });
  });

  it("collapses a run of blank lines into one space", () => {
    expect(editText(textInput(), paste("a\n\n\nb"))).toEqual({ value: "a b", cursor: 3 });
  });

  it("turns a trailing newline into a trailing space", () => {
    expect(editText(textInput(), paste("doi.org/10.1/x\n"))).toEqual({ value: "doi.org/10.1/x ", cursor: 15 });
  });

  it("accepts an empty paste", () => {
    expect(editText({ value: "ab", cursor: 1 }, paste(""))).toEqual({ value: "ab", cursor: 1 });
  });
});

describe("editText cursor movement", () => {
  it("moves left and right within the text", () => {
    const state = { value: "abc", cursor: 2 };
    expect(editText(state, key("left"))).toEqual({ value: "abc", cursor: 1 });
    expect(editText(state, key("right"))).toEqual({ value: "abc", cursor: 3 });
    expect(editText(state, key("C-b"))).toEqual({ value: "abc", cursor: 1 });
    expect(editText(state, key("C-f"))).toEqual({ value: "abc", cursor: 3 });
  });

  it("stops at both ends", () => {
    expect(editText({ value: "abc", cursor: 0 }, key("left"))).toEqual({ value: "abc", cursor: 0 });
    expect(editText({ value: "abc", cursor: 3 }, key("right"))).toEqual({ value: "abc", cursor: 3 });
  });

  it("jumps to the start with home and C-a", () => {
    expect(editText({ value: "abc", cursor: 2 }, key("home"))?.cursor).toBe(0);
    expect(editText({ value: "abc", cursor: 2 }, key("C-a"))?.cursor).toBe(0);
  });

  it("jumps to the end with end and C-e", () => {
    expect(editText({ value: "abc", cursor: 1 }, key("end"))?.cursor).toBe(3);
    expect(editText({ value: "abc", cursor: 1 }, key("C-e"))?.cursor).toBe(3);
  });

  it("moves back by words with M-b and C-left", () => {
    const text = "foo bar baz";
    expect(editText({ value: text, cursor: 11 }, key("M-b"))?.cursor).toBe(8);
    expect(editText({ value: text, cursor: 8 }, key("M-b"))?.cursor).toBe(4);
    expect(editText({ value: text, cursor: 4 }, key("M-b"))?.cursor).toBe(0);
    expect(editText({ value: text, cursor: 0 }, key("M-b"))?.cursor).toBe(0);
    expect(editText({ value: text, cursor: 11 }, key("C-left"))?.cursor).toBe(8);
  });

  it("moves forward by words with M-f and C-right", () => {
    const text = "foo bar baz";
    expect(editText({ value: text, cursor: 0 }, key("M-f"))?.cursor).toBe(3);
    expect(editText({ value: text, cursor: 3 }, key("M-f"))?.cursor).toBe(7);
    expect(editText({ value: text, cursor: 7 }, key("M-f"))?.cursor).toBe(11);
    expect(editText({ value: text, cursor: 11 }, key("M-f"))?.cursor).toBe(11);
    expect(editText({ value: text, cursor: 0 }, key("C-right"))?.cursor).toBe(3);
  });

  it("skips runs of spaces when moving by words", () => {
    expect(editText({ value: "foo   bar", cursor: 9 }, key("M-b"))?.cursor).toBe(6);
    expect(editText({ value: "foo   bar", cursor: 6 }, key("M-b"))?.cursor).toBe(0);
    expect(editText({ value: "foo   bar", cursor: 3 }, key("M-f"))?.cursor).toBe(9);
  });

  it("does not change the text when moving", () => {
    expect(editText({ value: "a b c", cursor: 3 }, key("M-b"))?.value).toBe("a b c");
  });
});

describe("editText deletion", () => {
  it("deletes the character before the cursor with backspace and C-h", () => {
    expect(editText({ value: "abc", cursor: 2 }, key("backspace"))).toEqual({ value: "ac", cursor: 1 });
    expect(editText({ value: "abc", cursor: 3 }, key("C-h"))).toEqual({ value: "ab", cursor: 2 });
  });

  it("does nothing on backspace at the start", () => {
    expect(editText({ value: "abc", cursor: 0 }, key("backspace"))).toEqual({ value: "abc", cursor: 0 });
  });

  it("deletes the character under the cursor with delete and C-d", () => {
    expect(editText({ value: "abc", cursor: 1 }, key("delete"))).toEqual({ value: "ac", cursor: 1 });
    expect(editText({ value: "abc", cursor: 0 }, key("C-d"))).toEqual({ value: "bc", cursor: 0 });
  });

  it("does nothing on delete at the end", () => {
    expect(editText({ value: "abc", cursor: 3 }, key("delete"))).toEqual({ value: "abc", cursor: 3 });
  });

  it("deletes the word before the cursor with C-w", () => {
    expect(editText({ value: "foo bar", cursor: 7 }, key("C-w"))).toEqual({ value: "foo ", cursor: 4 });
  });

  it("deletes trailing spaces together with the word before them", () => {
    expect(editText({ value: "foo bar  ", cursor: 9 }, key("C-w"))).toEqual({ value: "foo ", cursor: 4 });
  });

  it("deletes only up to the cursor when it is inside a word", () => {
    expect(editText({ value: "foo bar", cursor: 6 }, key("C-w"))).toEqual({ value: "foo r", cursor: 4 });
  });

  it("does nothing on C-w at the start", () => {
    expect(editText({ value: "foo", cursor: 0 }, key("C-w"))).toEqual({ value: "foo", cursor: 0 });
  });

  it("deletes the word before the cursor with M-backspace", () => {
    expect(editText({ value: "foo bar", cursor: 7 }, key("M-backspace"))).toEqual({ value: "foo ", cursor: 4 });
  });

  it("deletes everything before the cursor with C-u", () => {
    expect(editText({ value: "hello world", cursor: 5 }, key("C-u"))).toEqual({ value: " world", cursor: 0 });
  });

  it("deletes everything after the cursor with C-k", () => {
    expect(editText({ value: "hello world", cursor: 5 }, key("C-k"))).toEqual({ value: "hello", cursor: 5 });
  });

  it("empties the field with C-u at the end", () => {
    expect(editText(textInput("hello"), key("C-u"))).toEqual({ value: "", cursor: 0 });
  });
});

describe("editText surrogate pairs", () => {
  // "a😀b": the emoji takes two code units, so b sits at index 3.
  const text = "a😀b";

  it("steps over a whole emoji with left and right", () => {
    expect(editText({ value: text, cursor: 3 }, key("left"))?.cursor).toBe(1);
    expect(editText({ value: text, cursor: 1 }, key("right"))?.cursor).toBe(3);
  });

  it("deletes a whole emoji with backspace", () => {
    expect(editText({ value: text, cursor: 3 }, key("backspace"))).toEqual({ value: "ab", cursor: 1 });
  });

  it("deletes a whole emoji with delete", () => {
    expect(editText({ value: text, cursor: 1 }, key("delete"))).toEqual({ value: "ab", cursor: 1 });
  });

  it("never leaves half of a pair behind", () => {
    let state: TextInputState = textInput("😀😀😀");
    state = apply(state, key("backspace"));
    expect(state).toEqual({ value: "😀😀", cursor: 4 });
    state = apply(state, key("home"), key("delete"));
    expect(state).toEqual({ value: "😀", cursor: 0 });
  });

  it("types an emoji and removes it again", () => {
    expect(apply(textInput("x"), typed("😀"), key("backspace"))).toEqual({ value: "x", cursor: 1 });
  });
});

describe("editText unhandled events", () => {
  it("returns undefined for keys that are not editing keys", () => {
    for (const id of ["up", "down", "enter", "esc", "tab", "S-tab", "f1", "f5", "pageup", "C-x", "C-c", "M-x", "insert"]) {
      expect(editText(textInput("abc"), key(id))).toBeUndefined();
    }
  });

  it("returns undefined for mouse events", () => {
    expect(editText(textInput("abc"), { type: "mouse", kind: "down", button: 0, x: 1, y: 1 })).toBeUndefined();
  });
});
