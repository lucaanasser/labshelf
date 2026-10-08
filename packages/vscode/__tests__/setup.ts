// Global test setup
// Configure test environment and global mocks here

// Node 18 does not expose `crypto` as a global by default. @labshelf/core's
// sync layer uses `crypto.subtle.digest` (Web Crypto), so expose the
// equivalent from node:crypto for tests running on older Node versions.
if (typeof (globalThis as { crypto?: unknown }).crypto === "undefined") {
  const { webcrypto } = require("node:crypto") as { webcrypto: unknown };
  Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
}

// The shared LabShelf config (~/.config/labshelf/config.json) is per user; tests must never read or write the real one.
process.env["XDG_CONFIG_HOME"] = require("node:fs").mkdtempSync(
  require("node:path").join(require("node:os").tmpdir(), "labshelf-config-"),
);

beforeAll(() => {
  // Initialize test environment
});

afterEach(() => {
  // Clean up after each test
  jest.clearAllMocks();
});

afterAll(() => {
  // Clean up after all tests
});
