/**
 * Google Drive OAuth via the WebExtension identity API. Uses
 * `bx.identity.launchWebAuthFlow` with the chromiumapp.org redirect (emulated
 * on Firefox by the polyfill) and the implicit `response_type=token` flow, so
 * no client secret is ever shipped with the extension.
 *
 * Because the implicit flow returns no refresh token, this provider renews
 * the access token by re-running the same flow with `interactive: false`
 * before the current token expires.
 *
 * Implements the cross-platform `IAuthProvider` from @labshelf/core, so the
 * same Drive RemoteProvider works in VS Code and in the browser.
 *
 * @depends @labshelf/core IAuthProvider, platform/browserApi, tokenStore, oauthConfig
 * @dependents sync/browserSyncController (Phase 4), background message handlers
 */
import type { IAuthProvider } from "@labshelf/core";
import { bx } from "../../platform/browserApi";
import { clearToken, loadToken, saveToken, type StoredToken } from "./tokenStore";
import { CLIENT_ID_CHROME, CLIENT_ID_FIREFOX, SCOPES } from "./oauthConfig";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const REFRESH_LEEWAY_MS = 60_000;

/** Returns true when the host browser is Firefox (moz-extension://). */
function isFirefox(): boolean {
  try {
    return bx.runtime.getURL("/").startsWith("moz-extension://");
  } catch {
    return false;
  }
}

function clientId(): string {
  return isFirefox() ? CLIENT_ID_FIREFOX : CLIENT_ID_CHROME;
}

function buildAuthUrl(redirectUri: string, prompt: "none" | "consent"): string {
  const url = new URL(AUTH_URL);
  url.searchParams.set("response_type", "token");
  url.searchParams.set("client_id", clientId());
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", SCOPES.join(" "));
  url.searchParams.set("prompt", prompt);
  url.searchParams.set("include_granted_scopes", "true");
  return url.toString();
}

function parseRedirect(redirect: string): { accessToken: string; expiresIn: number; scope: string } {
  const hashIdx = redirect.indexOf("#");
  if (hashIdx < 0) throw new Error("OAuth redirect missing token fragment");
  const params = new URLSearchParams(redirect.slice(hashIdx + 1));
  const accessToken = params.get("access_token");
  const expiresIn = Number(params.get("expires_in"));
  const scope = params.get("scope") ?? SCOPES.join(" ");
  const error = params.get("error");
  if (error) throw new Error(`OAuth error: ${error}`);
  if (!accessToken || !Number.isFinite(expiresIn)) {
    throw new Error("OAuth redirect missing access_token or expires_in");
  }
  return { accessToken, expiresIn, scope };
}

export class BrowserDriveAuth implements IAuthProvider {
  private token: StoredToken | null = null;
  private hydrated = false;
  private refreshing: Promise<void> | null = null;

  isAuthenticated(): boolean {
    return this.token !== null && this.token.expiryMs > Date.now();
  }

  async getAccessToken(): Promise<string> {
    await this.hydrate();
    if (!this.token) {
      throw new Error("Not authenticated. Call authenticate() first.");
    }
    if (this.token.expiryMs <= Date.now() + REFRESH_LEEWAY_MS) {
      await this.refreshSilently();
    }
    if (!this.token) {
      throw new Error("Token refresh failed; re-authentication required.");
    }
    return this.token.accessToken;
  }

  async authenticate(): Promise<void> {
    this.token = await this.runFlow(true);
    await saveToken(this.token);
  }

  async revoke(): Promise<void> {
    await this.hydrate();
    const previous = this.token;
    this.token = null;
    await clearToken();
    if (previous) {
      try {
        await fetch(`${REVOKE_URL}?token=${encodeURIComponent(previous.accessToken)}`, { method: "POST" });
      } catch {
        // best effort — local state is already cleared
      }
    }
  }

  private async hydrate(): Promise<void> {
    if (this.hydrated) return;
    this.token = await loadToken();
    this.hydrated = true;
  }

  private refreshSilently(): Promise<void> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      try {
        this.token = await this.runFlow(false);
        await saveToken(this.token);
      } catch {
        // Silent refresh refused (e.g. user revoked consent) — drop the token
        // so the next call surfaces the need to re-authenticate.
        this.token = null;
        await clearToken();
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  private async runFlow(interactive: boolean): Promise<StoredToken> {
    const redirectUri = bx.identity.getRedirectURL();
    const authUrl = buildAuthUrl(redirectUri, interactive ? "consent" : "none");
    const redirect = await bx.identity.launchWebAuthFlow({ url: authUrl, interactive });
    if (!redirect) throw new Error("launchWebAuthFlow returned no redirect URL");
    const { accessToken, expiresIn, scope } = parseRedirect(redirect);
    return {
      accessToken,
      expiryMs: Date.now() + expiresIn * 1000,
      scope,
    };
  }
}
