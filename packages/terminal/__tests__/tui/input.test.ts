import { InputDecoder, type InputEvent } from "../../src/tui/input";

function decode(chunk: string): InputEvent[] {
  return new InputDecoder().feed(chunk);
}

function ids(chunk: string): string[] {
  return decode(chunk).map((event) => (event.type === "key" ? event.id : `<${event.type}>`));
}

describe("InputDecoder printable keys", () => {
  it("decodes a letter with its text", () => {
    expect(decode("j")).toEqual([{ type: "key", id: "j", text: "j" }]);
  });

  it("keeps the case of the letter in the id", () => {
    expect(decode("G")).toEqual([{ type: "key", id: "G", text: "G" }]);
  });

  it("names the space key and still carries the text", () => {
    expect(decode(" ")).toEqual([{ type: "key", id: "space", text: " " }]);
  });

  it("decodes punctuation used by key bindings", () => {
    expect(ids("?:/.,")).toEqual(["?", ":", "/", ".", ","]);
  });

  it("decodes several keys arriving in one chunk, in order", () => {
    expect(ids("gg")).toEqual(["g", "g"]);
    expect(ids("j k")).toEqual(["j", "space", "k"]);
  });

  it("decodes accented letters, CJK and emoji as single keys with their text", () => {
    expect(decode("é")).toEqual([{ type: "key", id: "é", text: "é" }]);
    expect(decode("日")).toEqual([{ type: "key", id: "日", text: "日" }]);
    expect(decode("😀")).toEqual([{ type: "key", id: "😀", text: "😀" }]);
  });

  it("does not split a surrogate pair inside mixed text", () => {
    expect(decode("a😀b").map((event) => (event.type === "key" ? event.text : undefined))).toEqual(["a", "😀", "b"]);
  });
});

describe("InputDecoder control keys", () => {
  it("decodes ctrl letters", () => {
    expect(decode("\x01")).toEqual([{ type: "key", id: "C-a" }]);
    expect(decode("\x04")).toEqual([{ type: "key", id: "C-d" }]);
    expect(decode("\x03")).toEqual([{ type: "key", id: "C-c" }]);
    expect(decode("\x1a")).toEqual([{ type: "key", id: "C-z" }]);
  });

  it("gives control keys no text to insert", () => {
    for (const event of decode("\x01\x04\r\t\x7f")) {
      expect(event).not.toHaveProperty("text");
    }
  });

  it("decodes enter from CR, and LF as Ctrl-J (raw mode sends CR for Enter)", () => {
    expect(ids("\r")).toEqual(["enter"]);
    expect(ids("\n")).toEqual(["C-j"]);
  });

  it("decodes tab", () => {
    expect(ids("\t")).toEqual(["tab"]);
  });

  it("decodes backspace from DEL and BS", () => {
    expect(ids("\x7f")).toEqual(["backspace"]);
    expect(ids("\x08")).toEqual(["backspace"]);
  });

  it("decodes ctrl-space from NUL", () => {
    expect(ids("\x00")).toEqual(["C-space"]);
  });

  it("decodes the remaining C0 control codes as ctrl punctuation", () => {
    expect(ids("\x1c")).toEqual(["C-\\"]);
    expect(ids("\x1d")).toEqual(["C-]"]);
  });
});

describe("InputDecoder escape and arrows", () => {
  it("keeps a lone ESC pending until flushed", () => {
    const decoder = new InputDecoder();
    expect(decoder.feed("\x1b")).toEqual([]);
    expect(decoder.hasPending()).toBe(true);
    expect(decoder.flush()).toEqual([{ type: "key", id: "esc" }]);
    expect(decoder.hasPending()).toBe(false);
  });

  it("decodes plain arrows", () => {
    expect(ids("\x1b[A\x1b[B\x1b[C\x1b[D")).toEqual(["up", "down", "right", "left"]);
  });

  it("decodes home and end from CSI H/F", () => {
    expect(ids("\x1b[H\x1b[F")).toEqual(["home", "end"]);
  });

  it("decodes arrows with xterm modifier parameters", () => {
    expect(ids("\x1b[1;5A")).toEqual(["C-up"]);
    expect(ids("\x1b[1;2B")).toEqual(["S-down"]);
    expect(ids("\x1b[1;3C")).toEqual(["M-right"]);
    expect(ids("\x1b[1;5D")).toEqual(["C-left"]);
  });

  it("combines modifiers in the order ctrl, alt, shift", () => {
    expect(ids("\x1b[1;6A")).toEqual(["C-S-up"]);
    expect(ids("\x1b[1;4D")).toEqual(["M-S-left"]);
    expect(ids("\x1b[1;7C")).toEqual(["C-M-right"]);
    expect(ids("\x1b[1;8A")).toEqual(["C-M-S-up"]);
  });

  it("treats a modifier parameter of 1 as no modifier", () => {
    expect(ids("\x1b[1;1A")).toEqual(["up"]);
  });

  it("decodes shift-tab from CSI Z", () => {
    expect(ids("\x1b[Z")).toEqual(["S-tab"]);
    expect(ids("\x1b[1;2Z")).toEqual(["S-tab"]);
  });

  it("decodes two consecutive ESC bytes as an escape key and keeps the second pending", () => {
    const decoder = new InputDecoder();
    expect(decoder.feed("\x1b\x1b")).toEqual([{ type: "key", id: "esc" }]);
    expect(decoder.hasPending()).toBe(true);
    expect(decoder.flush()).toEqual([{ type: "key", id: "esc" }]);
  });
});

describe("InputDecoder SS3 keys", () => {
  it("decodes application-mode arrows and home/end", () => {
    expect(ids("\x1bOA\x1bOB\x1bOC\x1bOD")).toEqual(["up", "down", "right", "left"]);
    expect(ids("\x1bOH\x1bOF")).toEqual(["home", "end"]);
  });

  it("decodes F1 to F4", () => {
    expect(ids("\x1bOP\x1bOQ\x1bOR\x1bOS")).toEqual(["f1", "f2", "f3", "f4"]);
  });

  it("swallows an unknown SS3 sequence without leaking its bytes", () => {
    expect(ids("\x1bOzj")).toEqual(["j"]);
  });

  it("waits for the final byte of a split SS3 sequence", () => {
    const decoder = new InputDecoder();
    expect(decoder.feed("\x1bO")).toEqual([]);
    expect(decoder.feed("A")).toEqual([{ type: "key", id: "up" }]);
  });
});

describe("InputDecoder CSI tilde keys", () => {
  it("decodes navigation keys", () => {
    expect(ids("\x1b[2~")).toEqual(["insert"]);
    expect(ids("\x1b[3~")).toEqual(["delete"]);
    expect(ids("\x1b[5~")).toEqual(["pageup"]);
    expect(ids("\x1b[6~")).toEqual(["pagedown"]);
    expect(ids("\x1b[1~\x1b[4~")).toEqual(["home", "end"]);
    expect(ids("\x1b[7~\x1b[8~")).toEqual(["home", "end"]);
  });

  it("decodes function keys, skipping the gaps in the xterm numbering", () => {
    expect(ids("\x1b[11~\x1b[12~\x1b[13~\x1b[14~")).toEqual(["f1", "f2", "f3", "f4"]);
    expect(ids("\x1b[15~")).toEqual(["f5"]);
    expect(ids("\x1b[17~\x1b[18~\x1b[19~\x1b[20~\x1b[21~")).toEqual(["f6", "f7", "f8", "f9", "f10"]);
    expect(ids("\x1b[23~\x1b[24~")).toEqual(["f11", "f12"]);
  });

  it("decodes modifiers on tilde keys", () => {
    expect(ids("\x1b[3;5~")).toEqual(["C-delete"]);
    expect(ids("\x1b[5;3~")).toEqual(["M-pageup"]);
    expect(ids("\x1b[15;2~")).toEqual(["S-f5"]);
  });

  it("swallows an unknown tilde code", () => {
    expect(ids("\x1b[99~j")).toEqual(["j"]);
  });

  it("swallows unknown CSI sequences such as focus reports", () => {
    expect(ids("\x1b[Ij\x1b[O")).toEqual(["j"]);
  });
});

describe("InputDecoder Alt keys", () => {
  it("decodes ESC followed by a character as Alt+key", () => {
    expect(decode("\x1bx")).toEqual([{ type: "key", id: "M-x" }]);
    expect(ids("\x1bX")).toEqual(["M-X"]);
    expect(ids("\x1bb\x1bf")).toEqual(["M-b", "M-f"]);
  });

  it("names Alt+space", () => {
    expect(ids("\x1b ")).toEqual(["M-space"]);
  });

  it("decodes Alt+backspace and Alt+enter", () => {
    expect(ids("\x1b\x7f")).toEqual(["M-backspace"]);
    expect(ids("\x1b\r")).toEqual(["M-enter"]);
  });

  it("decodes Alt with multi-byte characters", () => {
    expect(ids("\x1bé")).toEqual(["M-é"]);
    expect(ids("\x1b😀j")).toEqual(["M-😀", "j"]);
  });

  it("decodes Alt+key followed by more input in one chunk", () => {
    expect(ids("a\x1bxb")).toEqual(["a", "M-x", "b"]);
  });

  it("completes a lone ESC with the next chunk into an Alt key", () => {
    const decoder = new InputDecoder();
    expect(decoder.feed("\x1b")).toEqual([]);
    expect(decoder.feed("x")).toEqual([{ type: "key", id: "M-x" }]);
    expect(decoder.hasPending()).toBe(false);
  });
});

describe("InputDecoder pending sequences", () => {
  it("holds an incomplete CSI sequence until the rest arrives", () => {
    const decoder = new InputDecoder();
    expect(decoder.feed("\x1b[")).toEqual([]);
    expect(decoder.hasPending()).toBe(true);
    expect(decoder.feed("A")).toEqual([{ type: "key", id: "up" }]);
    expect(decoder.hasPending()).toBe(false);
  });

  it("holds a CSI sequence split in the middle of its parameters", () => {
    const decoder = new InputDecoder();
    expect(decoder.feed("x\x1b[1;5")).toEqual([{ type: "key", id: "x", text: "x" }]);
    expect(decoder.feed("A")).toEqual([{ type: "key", id: "C-up" }]);
  });

  it("holds a sequence split over three chunks", () => {
    const decoder = new InputDecoder();
    expect(decoder.feed("\x1b")).toEqual([]);
    expect(decoder.feed("[1;")).toEqual([]);
    expect(decoder.feed("2D")).toEqual([{ type: "key", id: "S-left" }]);
  });

  it("flush turns a lone ESC into an escape key", () => {
    const decoder = new InputDecoder();
    decoder.feed("\x1b");
    expect(decoder.flush()).toEqual([{ type: "key", id: "esc" }]);
  });

  it("flush reports ESC then the typed text for a truncated sequence", () => {
    const decoder = new InputDecoder();
    decoder.feed("\x1b[1;5");
    expect(decoder.flush().map((event) => (event.type === "key" ? event.id : event.type))).toEqual(["esc", "[", "1", ";", "5"]);
    expect(decoder.hasPending()).toBe(false);
  });

  it("flush reports ESC then O for a truncated SS3 sequence", () => {
    const decoder = new InputDecoder();
    decoder.feed("\x1bO");
    expect(decoder.flush().map((event) => (event.type === "key" ? event.id : event.type))).toEqual(["esc", "O"]);
  });

  it("flush with nothing pending returns nothing", () => {
    const decoder = new InputDecoder();
    expect(decoder.flush()).toEqual([]);
    decoder.feed("j");
    expect(decoder.flush()).toEqual([]);
  });

  it("does not report pending state for complete input", () => {
    const decoder = new InputDecoder();
    decoder.feed("\x1b[A");
    expect(decoder.hasPending()).toBe(false);
  });
});

describe("InputDecoder bracketed paste", () => {
  it("decodes a paste as one event, newlines included", () => {
    expect(decode("\x1b[200~hello\nworld\x1b[201~")).toEqual([{ type: "paste", text: "hello\nworld" }]);
  });

  it("decodes an empty paste", () => {
    expect(decode("\x1b[200~\x1b[201~")).toEqual([{ type: "paste", text: "" }]);
  });

  it("does not interpret escape sequences or control keys inside a paste", () => {
    expect(decode("\x1b[200~a\x1b[Ab\tc\x1b[201~")).toEqual([{ type: "paste", text: "a\x1b[Ab\tc" }]);
  });

  it("decodes keys typed before and after the paste", () => {
    expect(decode("a\x1b[200~PASTED\x1b[201~b")).toEqual([
      { type: "key", id: "a", text: "a" },
      { type: "paste", text: "PASTED" },
      { type: "key", id: "b", text: "b" },
    ]);
  });

  it("joins a paste split across two feed calls", () => {
    const decoder = new InputDecoder();
    expect(decoder.feed("\x1b[200~first ha")).toEqual([]);
    expect(decoder.feed("lf, second half\x1b[201~")).toEqual([{ type: "paste", text: "first half, second half" }]);
  });

  it("joins a paste split over several chunks and continues with keys afterwards", () => {
    const decoder = new InputDecoder();
    expect(decoder.feed("\x1b[200~one\n")).toEqual([]);
    expect(decoder.feed("two\n")).toEqual([]);
    expect(decoder.feed("three\x1b[201~j")).toEqual([
      { type: "paste", text: "one\ntwo\nthree" },
      { type: "key", id: "j", text: "j" },
    ]);
  });

  it("recognizes a paste start marker split across two feed calls", () => {
    const decoder = new InputDecoder();
    expect(decoder.feed("\x1b[20")).toEqual([]);
    expect(decoder.hasPending()).toBe(true);
    expect(decoder.feed("0~text\x1b[201~")).toEqual([{ type: "paste", text: "text" }]);
  });

  it("recognizes a paste start marker split right after the ESC", () => {
    const decoder = new InputDecoder();
    expect(decoder.feed("\x1b")).toEqual([]);
    expect(decoder.feed("[200~text\x1b[201~")).toEqual([{ type: "paste", text: "text" }]);
  });

  it("keeps the pasted multi-byte text intact", () => {
    expect(decode("\x1b[200~日本語 😀 é\x1b[201~")).toEqual([{ type: "paste", text: "日本語 😀 é" }]);
  });

  it("does not flush a paste in progress", () => {
    const decoder = new InputDecoder();
    decoder.feed("\x1b[200~partial");
    expect(decoder.flush()).toEqual([]);
    expect(decoder.feed("!\x1b[201~")).toEqual([{ type: "paste", text: "partial!" }]);
  });

  it("decodes two pastes in a row", () => {
    expect(decode("\x1b[200~a\x1b[201~\x1b[200~b\x1b[201~")).toEqual([
      { type: "paste", text: "a" },
      { type: "paste", text: "b" },
    ]);
  });
});

describe("InputDecoder mouse", () => {
  it("decodes a left button press with 0-based coordinates", () => {
    expect(decode("\x1b[<0;10;5M")).toEqual([{ type: "mouse", kind: "down", button: 0, x: 9, y: 4 }]);
  });

  it("decodes a release from the lowercase final byte", () => {
    expect(decode("\x1b[<0;10;5m")).toEqual([{ type: "mouse", kind: "up", button: 0, x: 9, y: 4 }]);
  });

  it("decodes the middle and right buttons", () => {
    expect(decode("\x1b[<1;1;1M")).toEqual([{ type: "mouse", kind: "down", button: 1, x: 0, y: 0 }]);
    expect(decode("\x1b[<2;3;4M")).toEqual([{ type: "mouse", kind: "down", button: 2, x: 2, y: 3 }]);
  });

  it("decodes the wheel", () => {
    expect(decode("\x1b[<64;10;5M")).toEqual([{ type: "mouse", kind: "wheel-up", button: 0, x: 9, y: 4 }]);
    expect(decode("\x1b[<65;10;5M")).toEqual([{ type: "mouse", kind: "wheel-down", button: 0, x: 9, y: 4 }]);
  });

  it("decodes drags with the button held", () => {
    expect(decode("\x1b[<32;3;4M")).toEqual([{ type: "mouse", kind: "drag", button: 0, x: 2, y: 3 }]);
    expect(decode("\x1b[<34;3;4M")).toEqual([{ type: "mouse", kind: "drag", button: 2, x: 2, y: 3 }]);
  });

  it("handles large coordinates", () => {
    expect(decode("\x1b[<0;250;100M")).toEqual([{ type: "mouse", kind: "down", button: 0, x: 249, y: 99 }]);
  });

  it("swallows a mouse report with a missing coordinate", () => {
    expect(ids("\x1b[<0;1Mj")).toEqual(["j"]);
  });

  it("decodes mouse reports mixed with keys", () => {
    expect(decode("a\x1b[<0;2;3Mb")).toEqual([
      { type: "key", id: "a", text: "a" },
      { type: "mouse", kind: "down", button: 0, x: 1, y: 2 },
      { type: "key", id: "b", text: "b" },
    ]);
  });

  it("waits for the rest of a split mouse report", () => {
    const decoder = new InputDecoder();
    expect(decoder.feed("\x1b[<0;1")).toEqual([]);
    expect(decoder.feed("2;7M")).toEqual([{ type: "mouse", kind: "down", button: 0, x: 11, y: 6 }]);
  });
});

describe("InputDecoder regressions", () => {
  it("finishes a paste whose end marker is split across two reads", () => {
    const d = new InputDecoder();
    expect(d.feed("\x1b[200~abc\x1b[20")).toEqual([]);
    expect(d.feed("1~")).toEqual([{ type: "paste", text: "abc" }]);
    expect(d.feed("j")).toEqual([{ type: "key", id: "j", text: "j" }]);
  });

  it("does not decode a cursor-position report as a key", () => {
    expect(new InputDecoder().feed("\x1b[12;40R")).toEqual([]);
    expect(new InputDecoder().feed("\x1b[1;5R")).toEqual([{ type: "key", id: "C-f3" }]);
  });
});
