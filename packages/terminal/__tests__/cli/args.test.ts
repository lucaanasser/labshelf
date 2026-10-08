import { parseArgs, stringFlag } from "../../src/cli/args";

describe("parseArgs", () => {
  it("splits the command from positionals and flags", () => {
    expect(parseArgs(["ls", "ML/Vision", "-r"])).toEqual({ command: "ls", positionals: ["ML/Vision"], flags: { recursive: true } });
  });

  it("returns no command for empty input (the TUI starts)", () => {
    expect(parseArgs([])).toEqual({ command: undefined, positionals: [], flags: {} });
  });

  it("accepts flags before the command", () => {
    const parsed = parseArgs(["--json", "-L", "/lib", "ls"]);
    expect(parsed.command).toBe("ls");
    expect(parsed.flags).toEqual({ json: true, library: "/lib" });
  });

  describe("long flags", () => {
    it("takes the next argument as the value of a value flag", () => {
      expect(parseArgs(["add", "--to", "ML", "paper.pdf"])).toEqual({
        command: "add", positionals: ["paper.pdf"], flags: { to: "ML" },
      });
      expect(parseArgs(["ls", "--sort", "year!"]).flags).toEqual({ sort: "year!" });
      expect(parseArgs(["--library", "/data/lib"]).flags).toEqual({ library: "/data/lib" });
      expect(parseArgs(["bib", "--output", "refs.bib", "--collection", "ML"]).flags).toEqual({ output: "refs.bib", collection: "ML" });
    });

    it("accepts --name=value for any flag, keeping '=' inside the value", () => {
      expect(parseArgs(["--library=/data/lib"]).flags).toEqual({ library: "/data/lib" });
      expect(parseArgs(["--to=ML"]).flags).toEqual({ to: "ML" });
      expect(parseArgs(["--sort=year"]).flags).toEqual({ sort: "year" });
      expect(parseArgs(["--x=a=b"]).flags).toEqual({ x: "a=b" });
      expect(parseArgs(["--json=false"]).flags).toEqual({ json: "false" });
    });

    it("keeps an empty value after '='", () => {
      expect(parseArgs(["--to="]).flags).toEqual({ to: "" });
    });

    it("treats every other long flag as a boolean", () => {
      expect(parseArgs(["ls", "--json", "--recursive", "--help"]).flags).toEqual({ json: true, recursive: true, help: true });
      // "--json" takes no value, so the next word is a positional.
      expect(parseArgs(["search", "--json", "attention"]).positionals).toEqual(["attention"]);
    });

    it("falls back to true when a value flag is the last argument", () => {
      expect(parseArgs(["--library"]).flags).toEqual({ library: true });
      expect(parseArgs(["bib", "--output"]).flags).toEqual({ output: true });
    });

    it("lets a value flag swallow the next argument even if it looks like a flag", () => {
      expect(parseArgs(["--to", "--json"]).flags).toEqual({ to: "--json" });
    });
  });

  describe("short flags", () => {
    it("maps -L, -o and -c to their value flags and reads the next argument", () => {
      expect(parseArgs(["-L", "/lib", "ls"])).toEqual({ command: "ls", positionals: [], flags: { library: "/lib" } });
      expect(parseArgs(["bib", "-o", "refs.bib"]).flags).toEqual({ output: "refs.bib" });
      expect(parseArgs(["bib", "-c", "ML/Vision"]).flags).toEqual({ collection: "ML/Vision" });
    });

    it("maps -r, -h, -v and -j to boolean flags", () => {
      expect(parseArgs(["ls", "-r"]).flags).toEqual({ recursive: true });
      expect(parseArgs(["-h"]).flags).toEqual({ help: true });
      expect(parseArgs(["-v"]).flags).toEqual({ version: true });
      expect(parseArgs(["search", "-j", "x"]).flags).toEqual({ json: true });
    });

    it("keeps an unknown short flag as a positional, so `tag p1 -a` removes the tag \"a\"", () => {
      expect(parseArgs(["ls", "-z"])).toEqual({ command: "ls", positionals: ["-z"], flags: {} });
      expect(parseArgs(["tag", "p1", "-a", "+b"]).positionals).toEqual(["p1", "-a", "+b"]);
    });

    it("falls back to true when a short value flag is the last argument", () => {
      expect(parseArgs(["bib", "-o"]).flags).toEqual({ output: true });
      expect(parseArgs(["-L"]).flags).toEqual({ library: true });
    });

    it("treats a lone dash and negative numbers as positionals", () => {
      expect(parseArgs(["cmd", "-", "-5"]).positionals).toEqual(["-", "-5"]);
    });
  });

  describe("--", () => {
    it("ends option parsing: everything after it is a positional", () => {
      expect(parseArgs(["add", "--", "--weird.pdf", "-x", "--to"])).toEqual({
        command: "add", positionals: ["--weird.pdf", "-x", "--to"], flags: {},
      });
    });

    it("can supply the command itself", () => {
      expect(parseArgs(["--json", "--", "ls", "ML"])).toEqual({ command: "ls", positionals: ["ML"], flags: { json: true } });
    });

    it("works with nothing after it", () => {
      expect(parseArgs(["ls", "--"])).toEqual({ command: "ls", positionals: [], flags: {} });
    });
  });

  it("keeps tag-style arguments (+tag, -tag) as positionals", () => {
    expect(parseArgs(["tag", "vaswani2017attention", "+nlp", "-survey"]).positionals).toEqual(["vaswani2017attention", "+nlp", "-survey"]);
  });

  it("lets the last occurrence of a repeated flag win", () => {
    expect(parseArgs(["--to", "A", "--to", "B"]).flags).toEqual({ to: "B" });
  });
});

describe("stringFlag", () => {
  it("returns string values only", () => {
    const flags = { to: "ML", json: true, empty: "" };
    expect(stringFlag(flags, "to")).toBe("ML");
    expect(stringFlag(flags, "empty")).toBe("");
    expect(stringFlag(flags, "json")).toBeUndefined();
    expect(stringFlag(flags, "missing")).toBeUndefined();
  });
});
