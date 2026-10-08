/**
 * Google Drive sign-in for the terminal: OAuth 2.0 Authorization Code + PKCE with a loopback redirect, the same flow
 * and OAuth client as the VS Code extension (sync/auth/googleDriveAuth.ts there), with the tokens in the terminal's
 * own TokenStore. The browser is opened for the user; the URL is also handed to the caller to print, for SSH sessions
 * or when no browser can be launched.
 *
 * @depends node:http, node:crypto, sync/tokenStore, sync/googleDriveCredentials
 * @dependents sync/syncService, cli auth
 */
import * as crypto from "node:crypto";
import * as http from "node:http";

import type { IAuthProvider } from "@labshelf/core";

import { CLIENT_ID as BUILT_IN_CLIENT_ID, CLIENT_SECRET as BUILT_IN_CLIENT_SECRET } from "./googleDriveCredentials.js";
import type { TokenData, TokenStore } from "./tokenStore.js";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const SCOPES = ["https://www.googleapis.com/auth/drive.file", "https://www.googleapis.com/auth/drive.appdata"].join(" ");
const LOGIN_TIMEOUT_MS = 5 * 60_000;

export interface OAuthClient {
  clientId: string;
  clientSecret: string;
}

/**
 * The OAuth client: environment first, then the credentials bundled at build time.
 * @usedBy app/context, cli doctor
 * @returns the client, or undefined when none is configured
 */
export function resolveOAuthClient(env: NodeJS.ProcessEnv = process.env): OAuthClient | undefined {
  const clientId = env["LABSHELF_GOOGLE_CLIENT_ID"] || BUILT_IN_CLIENT_ID;
  const clientSecret = env["LABSHELF_GOOGLE_CLIENT_SECRET"] || BUILT_IN_CLIENT_SECRET;
  if (!clientId || clientId.startsWith("YOUR_")) { return undefined; }
  return { clientId, clientSecret: clientSecret.startsWith("YOUR_") ? "" : clientSecret };
}

/** Raised when the stored refresh token no longer works; the user has to sign in again. */
export class ReauthRequiredError extends Error {
  constructor(message = "Google Drive access expired or was revoked. Sign in again with `labshelf auth login`.") {
    super(message);
    this.name = "ReauthRequiredError";
  }
}

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

export interface LoginOptions {
  /** Opens the authorization URL in a browser; failures are ignored (the URL is also given to onUrl). */
  openBrowser: (url: string) => void;
  /** Receives the authorization URL as soon as it is known. */
  onUrl?: (url: string) => void;
  timeoutMs?: number;
}

/** IAuthProvider for createGoogleDriveProvider, backed by a TokenStore. */
export class CliDriveAuth implements IAuthProvider {
  private tokens: TokenData | null = null;
  private loaded = false;

  constructor(
    private readonly client: OAuthClient | undefined,
    private readonly store: TokenStore,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /** @returns where the tokens are kept */
  get storeKind(): TokenStore["kind"] {
    return this.store.kind;
  }

  /** @returns true when an OAuth client is configured at all */
  isConfigured(): boolean {
    return this.client !== undefined;
  }

  /**
   * Loads stored tokens once.
   * @usedBy sync/syncService
   * @returns void
   */
  async load(): Promise<void> {
    if (this.loaded) { return; }
    this.tokens = await this.store.load();
    this.loaded = true;
  }

  isAuthenticated(): boolean {
    return this.tokens !== null;
  }

  async getAccessToken(): Promise<string> {
    await this.load();
    if (!this.tokens) { throw new ReauthRequiredError("Not signed in to Google Drive. Run `labshelf auth login`."); }
    if (this.tokens.expiry_ms <= Date.now() + 60_000 || !this.tokens.access_token) { await this.refresh(); }
    return this.tokens.access_token;
  }

  /** IAuthProvider.authenticate: interactive login with default options is not possible here. */
  async authenticate(): Promise<void> {
    throw new Error("Use `labshelf auth login` (or :login in the TUI) to sign in.");
  }

  /**
   * Runs the PKCE loopback flow and stores the tokens.
   * @usedBy cli auth login, ui/app (:login)
   * @returns void
   */
  async login(options: LoginOptions): Promise<void> {
    const client = this.requireClient();
    const verifier = base64url(crypto.randomBytes(32));
    const challenge = base64url(crypto.createHash("sha256").update(verifier).digest());
    const state = base64url(crypto.randomBytes(16));
    const { code, redirectUri } = await this.waitForCode(state, options, (port) => {
      const url = new URL(AUTH_URL);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("client_id", client.clientId);
      url.searchParams.set("redirect_uri", `http://127.0.0.1:${port}`);
      url.searchParams.set("scope", SCOPES);
      url.searchParams.set("code_challenge_method", "S256");
      url.searchParams.set("code_challenge", challenge);
      url.searchParams.set("access_type", "offline");
      url.searchParams.set("prompt", "consent");
      url.searchParams.set("state", state);
      return url.toString();
    });
    const tokens = await this.exchange({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    });
    if (!tokens.refresh_token) { throw new Error("Google did not return a refresh token; try signing in again."); }
    this.tokens = { access_token: tokens.access_token, refresh_token: tokens.refresh_token, expiry_ms: tokens.expiry_ms };
    this.loaded = true;
    await this.store.save(this.tokens);
  }

  /**
   * Revokes the refresh token (best effort) and forgets it.
   * @usedBy cli auth logout, ui/app (:logout)
   * @returns void
   */
  async revoke(): Promise<void> {
    await this.load();
    if (this.tokens) {
      await this.fetchImpl(`${REVOKE_URL}?token=${encodeURIComponent(this.tokens.refresh_token)}`, { method: "POST" })
        .catch(() => undefined);
    }
    this.tokens = null;
    await this.store.clear();
  }

  private requireClient(): OAuthClient {
    if (!this.client) {
      throw new Error("No Google OAuth client configured. Set LABSHELF_GOOGLE_CLIENT_ID/SECRET or rebuild with the VS Code credentials.");
    }
    return this.client;
  }

  private async refresh(): Promise<void> {
    if (!this.tokens) { throw new ReauthRequiredError(); }
    const data = await this.exchange({ grant_type: "refresh_token", refresh_token: this.tokens.refresh_token });
    this.tokens = {
      access_token: data.access_token,
      refresh_token: data.refresh_token || this.tokens.refresh_token,
      expiry_ms: data.expiry_ms,
    };
    await this.store.save(this.tokens);
  }

  private async exchange(params: Record<string, string>): Promise<TokenData> {
    const client = this.requireClient();
    const body = new URLSearchParams({ ...params, client_id: client.clientId });
    if (client.clientSecret) { body.set("client_secret", client.clientSecret); }
    const res = await this.fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      if (params["grant_type"] === "refresh_token" && (res.status === 400 || res.status === 401) && /invalid_grant/.test(text)) {
        this.tokens = null;
        await this.store.clear();
        throw new ReauthRequiredError();
      }
      throw new Error(`Google token request failed: HTTP ${res.status} ${text.slice(0, 200)}`);
    }
    const data = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number };
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token ?? "",
      expiry_ms: Date.now() + data.expires_in * 1000,
    };
  }

  // One loopback server from port discovery to code capture; the state parameter rejects stray or forged redirects.
  private waitForCode(
    state: string,
    options: LoginOptions,
    buildUrl: (port: number) => string,
  ): Promise<{ code: string; redirectUri: string }> {
    return new Promise((resolve, reject) => {
      let port = 0;
      const finish = (error: Error | undefined, code?: string): void => {
        clearTimeout(timer);
        server.close();
        if (error) { reject(error); } else { resolve({ code: code!, redirectUri: `http://127.0.0.1:${port}` }); }
      };
      const server = http.createServer((req, res) => {
        const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
        const code = url.searchParams.get("code");
        const error = url.searchParams.get("error");
        if (!code && !error) {
          res.writeHead(204);
          res.end();
          return;
        }
        if (url.searchParams.get("state") !== state) {
          res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("LabShelf: this sign-in link does not belong to the running login. Close this tab and try again.");
          return;
        }
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(error
          ? "<p>LabShelf: sign-in was cancelled. You can close this tab.</p>"
          : "<p>LabShelf is connected to Google Drive. You can close this tab and return to the terminal.</p>");
        finish(error ? new Error(`Sign-in cancelled (${error})`) : undefined, code ?? undefined);
      });
      const timer = setTimeout(() => finish(new Error("Sign-in timed out")), options.timeoutMs ?? LOGIN_TIMEOUT_MS);
      server.on("error", (error) => finish(error));
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (!address || typeof address === "string") {
          finish(new Error("Could not open the local sign-in server"));
          return;
        }
        port = address.port;
        const url = buildUrl(port);
        options.onUrl?.(url);
        try {
          options.openBrowser(url);
        } catch {
          // The URL was handed to onUrl; the user can open it by hand.
        }
      });
    });
  }
}
