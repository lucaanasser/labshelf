// Core test setup: exposes Web Crypto as a global on Node versions that lack it.
if (typeof (globalThis as { crypto?: unknown }).crypto === "undefined") {
  const { webcrypto } = require("node:crypto") as { webcrypto: unknown };
  Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
}

afterEach(() => {
  jest.clearAllMocks();
});
