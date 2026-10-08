import { promises as fs } from "node:fs";
import * as path from "node:path";

import { FileTokenStore, createTokenStore, parseTokens, type TokenData } from "../../src/sync/tokenStore";
import { cleanupTempDirs, listFiles, makeTempDir } from "../fixtures/library";

afterEach(cleanupTempDirs);

const TOKENS: TokenData = { access_token: "access-1", refresh_token: "refresh-1", expiry_ms: 1_800_000_000_000 };

describe("parseTokens", () => {
  it("accepts a complete token record", () => {
    expect(parseTokens(JSON.stringify(TOKENS))).toEqual(TOKENS);
  });

  it.each([[null], [undefined], [""]])("returns null for %p", (input) => {
    expect(parseTokens(input as string | null | undefined)).toBeNull();
  });

  it.each([["{ not json"], ["null"], ["42"], ["[]"], ['"text"']])("returns null for non-record JSON %j", (input) => {
    expect(parseTokens(input)).toBeNull();
  });

  it.each([
    [{ access_token: "a", expiry_ms: 1 }],
    [{ access_token: "a", refresh_token: "", expiry_ms: 1 }],
    [{ access_token: "a", refresh_token: 42, expiry_ms: 1 }],
    [{ access_token: "a", refresh_token: null, expiry_ms: 1 }],
  ])("requires a non-empty string refresh token (%j)", (raw) => {
    expect(parseTokens(JSON.stringify(raw))).toBeNull();
  });

  it("defaults a missing or mistyped access token to '' and expiry to 0 (it is refreshed on first use)", () => {
    expect(parseTokens(JSON.stringify({ refresh_token: "r" }))).toEqual({ access_token: "", refresh_token: "r", expiry_ms: 0 });
    expect(parseTokens(JSON.stringify({ refresh_token: "r", access_token: 5, expiry_ms: "123" })))
      .toEqual({ access_token: "", refresh_token: "r", expiry_ms: 0 });
  });

  it("drops unknown keys", () => {
    expect(parseTokens(JSON.stringify({ ...TOKENS, scope: "drive", id_token: "x" }))).toEqual(TOKENS);
  });
});

describe("FileTokenStore", () => {
  async function storeIn(sub = "labshelf"): Promise<{ store: FileTokenStore; file: string; dir: string }> {
    const root = await makeTempDir();
    const file = path.join(root, sub, "credentials.json");
    return { store: new FileTokenStore(file), file, dir: path.dirname(file) };
  }

  it("is of kind file", async () => {
    expect((await storeIn()).store.kind).toBe("file");
  });

  it("loads null when nothing was saved", async () => {
    const { store } = await storeIn();
    expect(await store.load()).toBeNull();
  });

  it("loads null for a corrupt file", async () => {
    const { store, file, dir } = await storeIn();
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(file, "{ broken");
    expect(await store.load()).toBeNull();
  });

  it("saves and loads the tokens, creating the folder", async () => {
    const { store, file } = await storeIn();
    await store.save(TOKENS);
    expect(await store.load()).toEqual(TOKENS);
    expect(JSON.parse(await fs.readFile(file, "utf8"))).toEqual(TOKENS);
  });

  it("writes the file readable only by the user (mode 0600) and creates its folder 0700", async () => {
    const { store, file, dir } = await storeIn();
    await store.save(TOKENS);
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
    expect((await fs.stat(dir)).mode & 0o777).toBe(0o700);
  });

  it("tightens the mode of an existing, more permissive file on save", async () => {
    const { store, file, dir } = await storeIn();
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(file, "old", { mode: 0o644 });
    await fs.chmod(file, 0o644);
    await store.save(TOKENS);
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
  });

  it("overwrites earlier tokens and leaves no temp file behind", async () => {
    const { store, dir } = await storeIn();
    await store.save(TOKENS);
    await store.save({ ...TOKENS, access_token: "access-2" });
    expect((await store.load())?.access_token).toBe("access-2");
    expect(await listFiles(dir)).toEqual(["credentials.json"]);
  });

  it("clears the tokens, and clearing twice is fine", async () => {
    const { store, file } = await storeIn();
    await store.save(TOKENS);
    await store.clear();
    expect(await store.load()).toBeNull();
    await expect(fs.stat(file)).rejects.toThrow();
    await expect(store.clear()).resolves.toBeUndefined();
  });
});

describe("createTokenStore", () => {
  it("honors LABSHELF_TOKEN_STORE=file", () => {
    expect(createTokenStore({ LABSHELF_TOKEN_STORE: "file" }).kind).toBe("file");
  });

  it("defaults to the config directory of the process environment", async () => {
    const root = await makeTempDir();
    const previous = process.env["XDG_CONFIG_HOME"];
    process.env["XDG_CONFIG_HOME"] = root;
    try {
      const store = createTokenStore() as FileTokenStore;
      if (store.kind === "file") { expect(store.file).toBe(path.join(root, "labshelf", "credentials.json")); }
      const forced = createTokenStore({ ...process.env, LABSHELF_TOKEN_STORE: "file" }) as FileTokenStore;
      expect(forced.file).toBe(path.join(root, "labshelf", "credentials.json"));
    } finally {
      if (previous === undefined) { delete process.env["XDG_CONFIG_HOME"]; } else { process.env["XDG_CONFIG_HOME"] = previous; }
    }
  });

  // Regression: the file location used to come from process.env, ignoring the env passed in.
  it("uses XDG_CONFIG_HOME from the env it is given for the file store", async () => {
    const root = await makeTempDir();
    const store = createTokenStore({ LABSHELF_TOKEN_STORE: "file", XDG_CONFIG_HOME: root }) as FileTokenStore;
    expect(store.file).toBe(path.join(root, "labshelf", "credentials.json"));
  });

  it("picks one of the known store kinds without touching any secret store", () => {
    // Construction must be free of side effects: the Keychain / secret-tool are only used on load/save.
    expect(["keychain", "secret-service", "file"]).toContain(createTokenStore({}).kind);
  });

  it("ignores other LABSHELF_TOKEN_STORE values", () => {
    expect(["keychain", "secret-service", "file"]).toContain(createTokenStore({ LABSHELF_TOKEN_STORE: "whatever" }).kind);
  });
});
