/**
 * Conditional describe wrapper for tests that need node:sqlite, which only
 * exists from Node 22.5 onward. Local toolchains can run on older Node — CI
 * uses the same Node version as VSCode's bundled runtime.
 */
export function sqliteAvailable(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("node:sqlite");
    return true;
  } catch {
    return false;
  }
}

export const describeIfSqlite = sqliteAvailable() ? describe : describe.skip;

/**
 * Top-level placeholder so jest does not complain when describeIfSqlite skips
 * all tests in a file. The placeholder records environment status only.
 */
export function placeholderEnvTest(suiteName: string): void {
  test(`${suiteName}: sqlite ${sqliteAvailable() ? "available" : "not available"}`, () => {
    expect(typeof sqliteAvailable()).toBe("boolean");
  });
}
