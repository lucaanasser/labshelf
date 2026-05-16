/** OAuth 2.0 Authorization Code + PKCE loopback flow for the Drive API — persists tokens in VSCode SecretStorage. @depends vscode, node:http, node:crypto. @dependents googleDriveProvider, syncController */

import * as vscode from "vscode";
import * as http from "node:http";
import * as crypto from "node:crypto";

const CLIENT_ID = "REDACTED_CLIENT_ID";
const CLIENT_SECRET = "REDACTED_CLIENT_SECRET";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const SCOPES = [
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/drive.appdata",
].join(" ");
const SECRET_KEY = "labshelf.gdrive.tokens";

interface TokenData {
  access_token: string;
  refresh_token: string;
  expiry_ms: number;
}

// Encodes a Buffer as a URL-safe base64 string without padding.
function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

/** Manages Google Drive OAuth tokens via PKCE loopback flow. @usedBy googleDriveProvider, syncController. */
export class GoogleDriveAuth {
  private tokens: TokenData | null = null;

  constructor(private readonly context: vscode.ExtensionContext) {}

  /** Loads tokens from VSCode SecretStorage into memory. @usedBy syncController. @returns void */
  async loadPersistedState(): Promise<void> {
    const raw = await this.context.secrets.get(SECRET_KEY);
    if (raw) {
      try {
        this.tokens = JSON.parse(raw) as TokenData;
      } catch {
        this.tokens = null;
      }
    }
  }

  /** Returns true when valid tokens are held in memory. @usedBy syncController, googleDriveProvider. @returns boolean */
  isAuthenticated(): boolean {
    return this.tokens !== null;
  }

  /** Returns a valid access token, refreshing first if needed. @usedBy googleDriveProvider (via DriveClient). @returns string */
  async getAccessToken(): Promise<string> {
    if (!this.tokens) {
      throw new Error("Not authenticated. Call authenticate() first.");
    }
    await this.refreshIfNeeded();
    return this.tokens!.access_token;
  }

  /** Runs the PKCE loopback OAuth flow, exchanges the code for tokens, and persists them. @usedBy syncController, googleDriveProvider. @returns void */
  async authenticate(): Promise<void> {
    const verifier = base64url(crypto.randomBytes(32));
    const challenge = base64url(
      crypto.createHash("sha256").update(verifier).digest(),
    );

    const { code, redirectUri } = await this.runLoopbackFlow((port) => {
      const redirectUri = `http://127.0.0.1:${port}`;
      const authUrl = new URL(AUTH_URL);
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("client_id", CLIENT_ID);
      authUrl.searchParams.set("redirect_uri", redirectUri);
      authUrl.searchParams.set("scope", SCOPES);
      authUrl.searchParams.set("code_challenge_method", "S256");
      authUrl.searchParams.set("code_challenge", challenge);
      authUrl.searchParams.set("access_type", "offline");
      return { authUrl: authUrl.toString(), redirectUri };
    });

    const tokenData = await this.exchangeCode(code, verifier, redirectUri);
    this.tokens = tokenData;
    await this.context.secrets.store(SECRET_KEY, JSON.stringify(tokenData));
  }

  /** Revokes the refresh token, clears in-memory tokens, and removes the secret. @usedBy syncController, googleDriveProvider. @returns void */
  async revoke(): Promise<void> {
    if (this.tokens) {
      try {
        await fetch(`${REVOKE_URL}?token=${encodeURIComponent(this.tokens.refresh_token)}`, {
          method: "POST",
        });
      } catch {
        // best effort
      }
    }
    this.tokens = null;
    await this.context.secrets.delete(SECRET_KEY);
  }

  // Refreshes the access token if it expires within the next 60 seconds.
  private async refreshIfNeeded(): Promise<void> {
    if (!this.tokens) return;
    if (this.tokens.expiry_ms > Date.now() + 60_000) return;
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: this.tokens.refresh_token,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
      }).toString(),
    });
    if (!res.ok) {
      throw new Error(`Token refresh failed: ${res.status}`);
    }
    const data = (await res.json()) as {
      access_token: string;
      expires_in: number;
      refresh_token?: string;
    };
    this.tokens = {
      access_token: data.access_token,
      refresh_token: data.refresh_token ?? this.tokens.refresh_token,
      expiry_ms: Date.now() + data.expires_in * 1000,
    };
    await this.context.secrets.store(SECRET_KEY, JSON.stringify(this.tokens));
  }

  // Starts a single loopback HTTP server from port discovery through auth code capture, avoiding the race condition of closing and reopening on the same port.
  private runLoopbackFlow(
    buildUrls: (port: number) => { authUrl: string; redirectUri: string },
  ): Promise<{ code: string; redirectUri: string }> {
    return new Promise((resolve, reject) => {
      // Port captured once in the listen callback and reused in the request handler — avoids calling srv.address() after srv.close().
      let capturedPort = 0;

      const srv = http.createServer((req, res) => {
        const url = new URL(req.url ?? "/", `http://127.0.0.1:${capturedPort}`);
        const code = url.searchParams.get("code");
        const oauthError = url.searchParams.get("error");

        // Ignore browser noise (favicon, etc.) and only handle the OAuth redirect.
        if (!code && !oauthError) {
          res.writeHead(204);
          res.end();
          return;
        }

        res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Authentication complete. You may close this tab.");
        srv.close();

        if (code) {
          resolve({ code, redirectUri: `http://127.0.0.1:${capturedPort}` });
        } else {
          reject(new Error(`OAuth error: ${oauthError ?? "unknown"}`));
        }
      });

      srv.on("error", reject);
      srv.listen(0, "127.0.0.1", () => {
        const addr = srv.address();
        if (!addr || typeof addr === "string") {
          srv.close();
          reject(new Error("Could not bind loopback server"));
          return;
        }
        capturedPort = addr.port;
        const { authUrl } = buildUrls(capturedPort);
        vscode.env.openExternal(vscode.Uri.parse(authUrl)).then(
          undefined,
          (err: unknown) => { srv.close(); reject(err); },
        );
      });
    });
  }

  // Exchanges an authorization code for access and refresh tokens.
  private async exchangeCode(
    code: string,
    verifier: string,
    redirectUri: string,
  ): Promise<TokenData> {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code_verifier: verifier,
      }).toString(),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Token exchange failed: ${res.status} — ${body}`);
    }
    const data = (await res.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expiry_ms: Date.now() + data.expires_in * 1000,
    };
  }
}
