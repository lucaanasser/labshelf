/**
 * Minimal argv parser for the labshelf command: a command word, positionals, and long/short flags. Flags listed in
 * VALUE_FLAGS take a value ("--to ML", "--to=ML", "-o refs.bib"); every other flag is a boolean.
 *
 * @depends none
 * @dependents main, cli/commands
 */

export interface ParsedArgs {
  command: string | undefined;
  positionals: string[];
  flags: Record<string, string | boolean>;
}

const VALUE_FLAGS = new Set(["library", "to", "output", "collection", "dump-frame", "keys", "sort"]);
const SHORT: Record<string, string> = { L: "library", o: "output", c: "collection", r: "recursive", h: "help", v: "version", j: "json" };

/**
 * @usedBy main
 * @returns the parsed arguments
 */
export function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--") {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      const name = arg.slice(2, eq < 0 ? undefined : eq);
      if (eq >= 0) {
        flags[name] = arg.slice(eq + 1);
      } else if (VALUE_FLAGS.has(name) && i + 1 < argv.length) {
        flags[name] = argv[++i]!;
      } else {
        flags[name] = true;
      }
      continue;
    }
    if (/^-[A-Za-z]$/.test(arg) && SHORT[arg[1]!]) {
      const name = SHORT[arg[1]!]!;
      if (VALUE_FLAGS.has(name) && i + 1 < argv.length) { flags[name] = argv[++i]!; } else { flags[name] = true; }
      continue;
    }
    positionals.push(arg);
  }
  const [command, ...rest] = positionals;
  return { command, positionals: rest, flags };
}

/**
 * @usedBy cli/commands
 * @returns a string flag value, or undefined
 */
export function stringFlag(flags: ParsedArgs["flags"], name: string): string | undefined {
  const value = flags[name];
  return typeof value === "string" ? value : undefined;
}
