import { BINDINGS, keyLabel, resolveKeys, type Binding } from "../../src/ui/keymap";

function binding(keys: string[], extra: Partial<Binding> = {}): Binding {
  return { keys, action: "down", desc: keys.join(" "), group: "Navigate", ...extra };
}

describe("resolveKeys", () => {
  it("resolves a single key to its action", () => {
    const resolution = resolveKeys(["j"]);
    expect(resolution.kind).toBe("action");
    if (resolution.kind === "action") { expect(resolution.binding.action).toBe("down"); }
  });

  it("resolves an alias to the same action as its main key", () => {
    const down = resolveKeys(["down"]);
    expect(down.kind === "action" && down.binding.action).toBe("down");
    const enter = resolveKeys(["enter"]);
    expect(enter.kind === "action" && enter.binding.action).toBe("enter");
  });

  it("treats the first key of a multi-key binding as a prefix and lists what can follow", () => {
    const resolution = resolveKeys(["m"]);
    expect(resolution.kind).toBe("prefix");
    if (resolution.kind === "prefix") {
      expect(resolution.options.map((option) => option.keys[1]).sort()).toEqual(["d", "r", "u"]);
      expect(resolution.options.every((option) => option.action === "status")).toBe(true);
    }
  });

  it("resolves a complete multi-key sequence with its argument", () => {
    const resolution = resolveKeys(["m", "r"]);
    expect(resolution.kind).toBe("action");
    if (resolution.kind === "action") {
      expect(resolution.binding.action).toBe("status");
      expect(resolution.binding.arg).toBe("reading");
    }
  });

  it("gives each status key its own argument", () => {
    const arg = (keys: string[]): string | undefined => {
      const resolution = resolveKeys(keys);
      return resolution.kind === "action" ? resolution.binding.arg : undefined;
    };
    expect(arg(["m", "u"])).toBe("unread");
    expect(arg(["m", "r"])).toBe("reading");
    expect(arg(["m", "d"])).toBe("done");
  });

  it("resolves gg to the top and ga to all papers", () => {
    const top = resolveKeys(["g", "g"]);
    const home = resolveKeys(["g", "a"]);
    expect(top.kind === "action" && top.binding.action).toBe("top");
    expect(home.kind === "action" && home.binding.action).toBe("home");
  });

  it("lists the copy formats after y", () => {
    const resolution = resolveKeys(["y"]);
    expect(resolution.kind).toBe("prefix");
    if (resolution.kind === "prefix") {
      expect(resolution.options.map((option) => option.keys[1]).sort()).toEqual(["b", "c", "d", "k", "m", "p", "t"]);
    }
  });

  it("hides alias bindings from the options of a prefix", () => {
    const resolution = resolveKeys([","]);
    expect(resolution.kind).toBe("prefix");
    if (resolution.kind === "prefix") {
      expect(resolution.options.map((option) => option.keys[1]).sort()).toEqual(["a", "m", "s", "t", "y"]);
      expect(resolution.options.some((option) => option.alias)).toBe(false);
    }
  });

  it("still resolves the hidden reverse-sort aliases", () => {
    const resolution = resolveKeys([",", "Y"]);
    expect(resolution.kind).toBe("action");
    if (resolution.kind === "action") { expect(resolution.binding.arg).toBe("year!"); }
  });

  it("returns none for an unbound key", () => {
    expect(resolveKeys(["~"]).kind).toBe("none");
    expect(resolveKeys(["w"]).kind).toBe("none");
    expect(resolveKeys(["f12"]).kind).toBe("none");
  });

  it("returns none for an unbound continuation of a prefix", () => {
    expect(resolveKeys(["m", "z"]).kind).toBe("none");
    expect(resolveKeys(["g", "x"]).kind).toBe("none");
    expect(resolveKeys(["m", "r", "x"]).kind).toBe("none");
  });

  it("distinguishes case: m is a prefix while M is a move", () => {
    expect(resolveKeys(["m"]).kind).toBe("prefix");
    const move = resolveKeys(["M"]);
    expect(move.kind === "action" && move.binding.action).toBe("moveTo");
  });

  it("works with a custom binding list", () => {
    const list = [binding(["x"], { action: "up" }), binding(["a", "b"], { action: "top" })];
    const x = resolveKeys(["x"], list);
    expect(x.kind === "action" && x.binding.action).toBe("up");
    expect(resolveKeys(["a"], list).kind).toBe("prefix");
    expect(resolveKeys(["j"], list).kind).toBe("none");
  });

  it("prefers an exact match over longer sequences that start the same way", () => {
    const list = [binding(["g"], { action: "up" }), binding(["g", "g"], { action: "top" })];
    const resolution = resolveKeys(["g"], list);
    expect(resolution.kind).toBe("action");
  });

  it("returns a prefix with no options when only aliases continue the sequence", () => {
    const list = [binding(["x", "y"], { alias: true })];
    expect(resolveKeys(["x"], list)).toEqual({ kind: "prefix", options: [] });
  });
});

describe("BINDINGS table", () => {
  const sequence = (b: Binding): string => b.keys.join("\0");

  it("is not empty and every binding has keys, a description and a group", () => {
    expect(BINDINGS.length).toBeGreaterThan(40);
    for (const b of BINDINGS) {
      expect(b.keys.length).toBeGreaterThan(0);
      expect(b.keys.every((k) => k.length > 0)).toBe(true);
      expect(b.desc.length).toBeGreaterThan(0);
      expect(["Navigate", "Find", "Select", "Papers", "Copy", "Sort", "App"]).toContain(b.group);
    }
  });

  it("has no two bindings with the exact same key sequence", () => {
    const seen = new Map<string, Binding>();
    for (const b of BINDINGS) {
      const previous = seen.get(sequence(b));
      expect(previous === undefined ? undefined : `${keyLabel(b.keys)} is bound twice`).toBeUndefined();
      seen.set(sequence(b), b);
    }
  });

  it("has no key sequence that is the start of a longer one, which would make the longer one unreachable", () => {
    for (const short of BINDINGS) {
      for (const long of BINDINGS) {
        if (short === long || short.keys.length >= long.keys.length) { continue; }
        const shadowed = short.keys.every((k, i) => long.keys[i] === k);
        expect(shadowed ? `${keyLabel(short.keys)} shadows ${keyLabel(long.keys)}` : undefined).toBeUndefined();
      }
    }
  });

  it("resolves every binding's own keys back to that binding", () => {
    for (const b of BINDINGS) {
      const resolution = resolveKeys(b.keys);
      expect(resolution.kind).toBe("action");
      if (resolution.kind === "action") { expect(resolution.binding).toBe(b); }
    }
  });

  it("makes every proper prefix of every multi-key binding a prefix resolution", () => {
    for (const b of BINDINGS.filter((candidate) => candidate.keys.length > 1)) {
      for (let length = 1; length < b.keys.length; length++) {
        expect(resolveKeys(b.keys.slice(0, length)).kind).toBe("prefix");
      }
    }
  });

  it("gives every status, copy and sort binding an argument", () => {
    for (const b of BINDINGS.filter((candidate) => ["status", "yank", "sort"].includes(candidate.action))) {
      expect(b.arg).toBeDefined();
    }
  });

  it("marks the reverse sort variants as aliases so the help screen lists each sort once", () => {
    const reversed = BINDINGS.filter((b) => b.action === "sort" && b.arg?.endsWith("!"));
    expect(reversed.length).toBe(5);
    expect(reversed.every((b) => b.alias === true)).toBe(true);
  });
});

describe("keyLabel", () => {
  it("capitalizes the named keys the help screen shows", () => {
    expect(keyLabel(["space"])).toBe("Space");
    expect(keyLabel(["esc"])).toBe("Esc");
    expect(keyLabel(["tab"])).toBe("Tab");
    expect(keyLabel(["S-tab"])).toBe("S-Tab");
  });

  it("leaves other keys as they are", () => {
    expect(keyLabel(["j"])).toBe("j");
    expect(keyLabel(["C-d"])).toBe("C-d");
    expect(keyLabel(["G"])).toBe("G");
    expect(keyLabel(["?"])).toBe("?");
  });

  it("joins the keys of a sequence with spaces", () => {
    expect(keyLabel(["m", "r"])).toBe("m r");
    expect(keyLabel(["g", "g"])).toBe("g g");
    expect(keyLabel([",", "T"])).toBe(", T");
  });

  it("labels an empty sequence as an empty string", () => {
    expect(keyLabel([])).toBe("");
  });
});
