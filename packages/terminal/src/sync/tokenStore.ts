/**
 * Where the terminal keeps its Google Drive tokens. The VS Code extension keeps its own in VS Code's SecretStorage,
 * which no other process can read, so the terminal signs in once on its own (same Google account and OAuth client,
 * hence the same Drive files). Storage, best first: the macOS Keychain, the freedesktop Secret Service (secret-tool),
 * and a 0600 file in the config directory. LABSHELF_TOKEN_STORE=file forces the file.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { sharedConfigDir } from "@labshelf/core/node";

import { hasCommand } from "../platform/system.js";

export interface TokenData {
  access_token: string;
  refresh_token: string;
  expiry_ms: number;
}

export interface TokenStore {
  readonly kind: "keychain" | "secret-service" | "file";
  load(): Promise<TokenData | null>;
  save(tokens: TokenData): Promise<void>;
  clear(): Promise<void>;
}

const SERVICE = "labshelf.gdrive.tokens";

/**
 * Validates stored token JSON.
 * @returns the tokens, or null
 */
export function parseTokens(text: string | undefined | null): TokenData | null {
  if (!text) { return null; }
  try {
    const raw = JSON.parse(text) as Partial<TokenData>;
    if (typeof raw.refresh_token !== "string" || !raw.refresh_token) { return null; }
    return {
      access_token: typeof raw.access_token === "string" ? raw.access_token : "",
      refresh_token: raw.refresh_token,
      expiry_ms: typeof raw.expiry_ms === "number" ? raw.expiry_ms : 0,
    };
  } catch {
    return null;
  }
}

/** Tokens in a JSON file readable only by the user. */
export class FileTokenStore implements TokenStore {
  readonly kind = "file" as const;

  constructor(readonly file = path.join(sharedConfigDir(), "credentials.json")) {}

  async load(): Promise<TokenData | null> {
    try {
      return parseTokens(await fs.readFile(this.file, "utf8"));
    } catch {
      return null;
    }
  }

  async save(tokens: TokenData): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(tokens), { mode: 0o600 });
    await fs.rename(tmp, this.file);
    await fs.chmod(this.file, 0o600);
  }

  async clear(): Promise<void> {
    await fs.rm(this.file, { force: true });
  }
}

/** macOS login Keychain through /usr/bin/security. */
export class KeychainTokenStore implements TokenStore {
  readonly kind = "keychain" as const;
  private readonly account = os.userInfo().username;

  async load(): Promise<TokenData | null> {
    const result = spawnSync("/usr/bin/security", ["find-generic-password", "-s", SERVICE, "-a", this.account, "-w"], {
      encoding: "utf8",
    });
    return result.status === 0 ? parseTokens(result.stdout.trim()) : null;
  }

  async save(tokens: TokenData): Promise<void> {
    const result = spawnSync(
      "/usr/bin/security",
      ["add-generic-password", "-U", "-s", SERVICE, "-a", this.account, "-l", "LabShelf Google Drive", "-w", JSON.stringify(tokens)],
      { encoding: "utf8" },
    );
    if (result.status !== 0) { throw new Error(`Keychain write failed: ${result.stderr.trim() || result.status}`); }
  }

  async clear(): Promise<void> {
    spawnSync("/usr/bin/security", ["delete-generic-password", "-s", SERVICE, "-a", this.account], { encoding: "utf8" });
  }
}

/** freedesktop Secret Service (GNOME Keyring, KWallet) through secret-tool; the secret goes over stdin. */
export class SecretServiceTokenStore implements TokenStore {
  readonly kind = "secret-service" as const;

  async load(): Promise<TokenData | null> {
    const result = spawnSync("secret-tool", ["lookup", "service", SERVICE], { encoding: "utf8" });
    return result.status === 0 ? parseTokens(result.stdout.trim()) : null;
  }

  async save(tokens: TokenData): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const child = spawn("secret-tool", ["store", "--label=LabShelf Google Drive", "service", SERVICE], {
        stdio: ["pipe", "ignore", "pipe"],
      });
      let stderr = "";
      child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
      child.on("error", reject);
      child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`secret-tool failed: ${stderr.trim() || code}`))));
      child.stdin.end(JSON.stringify(tokens));
    });
  }

  async clear(): Promise<void> {
    spawnSync("secret-tool", ["clear", "service", SERVICE], { encoding: "utf8" });
  }
}

/**
 * Picks the most secure store available.
 * @returns the store
 */
export function createTokenStore(env: NodeJS.ProcessEnv = process.env): TokenStore {
  const file = path.join(sharedConfigDir(env), "credentials.json");
  if (env["LABSHELF_TOKEN_STORE"] === "file") { return new FileTokenStore(file); }
  if (process.platform === "darwin" && existsSync("/usr/bin/security")) { return new KeychainTokenStore(); }
  if (process.platform === "linux" && hasCommand("secret-tool", env) && env["DBUS_SESSION_BUS_ADDRESS"]) {
    return new SecretServiceTokenStore();
  }
  return new FileTokenStore(file);
}
