import * as crypto from "node:crypto";
import * as http from "node:http";

import { CliDriveAuth, ReauthRequiredError, resolveOAuthClient, type OAuthClient } from "../../src/sync/driveAuth";
import type { TokenData } from "../../src/sync/tokenStore";
import { MemoryTokenStore } from "../fixtures/fakeRemote";

const CLIENT: OAuthClient = { clientId: "cid.apps.googleusercontent.com", clientSecret: "csecret" };
const FRESH: TokenData = { access_token: "access-live", refresh_token: "refresh-1", expiry_ms: Date.now() + 3_600_000 };
const EXPIRED: TokenData = { access_token: "access-old", refresh_token: "refresh-1", expiry_ms: Date.now() - 1000 };

interface Call { url: string; method: string | undefined; body: URLSearchParams }

/** A fetch that records every call and answers with `respond`. */
function fakeFetch(respond: (call: Call) => Response | Promise<Response>): { fn: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const call: Call = { url: String(input), method: init?.method, body: new URLSearchParams(String(init?.body ?? "")) };
    calls.push(call);
    return respond(call);
  }) as typeof fetch;
  return { fn, calls };
}

function tokenResponse(body: Record<string, unknown> = {}, status = 200): Response {
  return new Response(JSON.stringify({ access_token: "access-new", expires_in: 3600, ...body }), {
    status, headers: { "content-type": "application/json" },
  });
}

/** A plain GET that closes its connection (so no keep-alive socket outlives the test). */
function httpGet(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { agent: false, headers: { Connection: "close" } }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => { body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", reject);
  });
}

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

describe("resolveOAuthClient", () => {
  it("uses LABSHELF_GOOGLE_CLIENT_ID / _SECRET from the environment", () => {
    expect(resolveOAuthClient({ LABSHELF_GOOGLE_CLIENT_ID: "env-id", LABSHELF_GOOGLE_CLIENT_SECRET: "env-secret" }))
      .toEqual({ clientId: "env-id", clientSecret: "env-secret" });
  });

  it("reads a placeholder secret as no secret (a client may be public)", () => {
    expect(resolveOAuthClient({ LABSHELF_GOOGLE_CLIENT_ID: "env-id", LABSHELF_GOOGLE_CLIENT_SECRET: "YOUR_SECRET_HERE" }))
      .toEqual({ clientId: "env-id", clientSecret: "" });
  });

  it("treats a YOUR_ placeholder id as not configured, whatever the secret", () => {
    expect(resolveOAuthClient({ LABSHELF_GOOGLE_CLIENT_ID: "YOUR_GOOGLE_OAUTH_CLIENT_ID", LABSHELF_GOOGLE_CLIENT_SECRET: "s" })).toBeUndefined();
    expect(resolveOAuthClient({ LABSHELF_GOOGLE_CLIENT_ID: "YOUR_GOOGLE_OAUTH_CLIENT_ID" })).toBeUndefined();
  });

  it("falls back to the bundled credentials: never a placeholder, either not configured or a real-looking client", () => {
    const client = resolveOAuthClient({});
    if (client) {
      expect(client.clientId.startsWith("YOUR_")).toBe(false);
      expect(client.clientId.length).toBeGreaterThan(0);
      expect(client.clientSecret.startsWith("YOUR_")).toBe(false);
    } else {
      expect(client).toBeUndefined();
    }
  });

  it("lets the environment win over the bundled credentials", () => {
    expect(resolveOAuthClient({ LABSHELF_GOOGLE_CLIENT_ID: "mine", LABSHELF_GOOGLE_CLIENT_SECRET: "mine-secret" })?.clientId).toBe("mine");
  });
});

describe("CliDriveAuth: state", () => {
  it("reports whether a client is configured and where tokens live", () => {
    const store = new MemoryTokenStore();
    expect(new CliDriveAuth(CLIENT, store).isConfigured()).toBe(true);
    expect(new CliDriveAuth(undefined, store).isConfigured()).toBe(false);
    expect(new CliDriveAuth(CLIENT, store).storeKind).toBe("file");
  });

  it("is not authenticated until load() found stored tokens", async () => {
    const auth = new CliDriveAuth(CLIENT, new MemoryTokenStore({ ...FRESH }));
    expect(auth.isAuthenticated()).toBe(false);
    await auth.load();
    expect(auth.isAuthenticated()).toBe(true);
  });

  it("stays unauthenticated when the store is empty", async () => {
    const auth = new CliDriveAuth(CLIENT, new MemoryTokenStore());
    await auth.load();
    expect(auth.isAuthenticated()).toBe(false);
  });

  it("loads the store only once", async () => {
    const store = new MemoryTokenStore({ ...FRESH });
    const auth = new CliDriveAuth(CLIENT, store);
    await auth.load();
    await auth.load();
    await auth.getAccessToken();
    expect(store.loads).toBe(1);
  });

  it("authenticate() refuses to run an interactive login by itself", async () => {
    await expect(new CliDriveAuth(CLIENT, new MemoryTokenStore()).authenticate()).rejects.toThrow(/labshelf auth login/);
  });
});

describe("CliDriveAuth.getAccessToken", () => {
  it("throws ReauthRequiredError when not signed in", async () => {
    const { fn, calls } = fakeFetch(() => tokenResponse());
    const auth = new CliDriveAuth(CLIENT, new MemoryTokenStore(), fn);
    const error = await auth.getAccessToken().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ReauthRequiredError);
    expect((error as Error).message).toMatch(/Not signed in/);
    expect(calls).toEqual([]);
  });

  it("returns a still-valid access token without calling Google", async () => {
    const { fn, calls } = fakeFetch(() => tokenResponse());
    const auth = new CliDriveAuth(CLIENT, new MemoryTokenStore({ ...FRESH }), fn);
    expect(await auth.getAccessToken()).toBe("access-live");
    expect(calls).toEqual([]);
  });

  it("refreshes an expired token, sends the refresh grant, and saves the new tokens", async () => {
    const store = new MemoryTokenStore({ ...EXPIRED });
    const { fn, calls } = fakeFetch(() => tokenResponse({ access_token: "access-refreshed", expires_in: 3600 }));
    const auth = new CliDriveAuth(CLIENT, store, fn);
    const before = Date.now();

    expect(await auth.getAccessToken()).toBe("access-refreshed");

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://oauth2.googleapis.com/token");
    expect(calls[0]!.method).toBe("POST");
    expect(Object.fromEntries(calls[0]!.body)).toEqual({
      grant_type: "refresh_token", refresh_token: "refresh-1", client_id: CLIENT.clientId, client_secret: "csecret",
    });
    expect(store.saves).toHaveLength(1);
    expect(store.tokens).toMatchObject({ access_token: "access-refreshed", refresh_token: "refresh-1" });
    expect(store.tokens!.expiry_ms).toBeGreaterThanOrEqual(before + 3_600_000);
    expect(store.tokens!.expiry_ms).toBeLessThanOrEqual(Date.now() + 3_600_000);
  });

  it("refreshes a token that expires within the next minute", async () => {
    const { fn, calls } = fakeFetch(() => tokenResponse());
    const auth = new CliDriveAuth(CLIENT, new MemoryTokenStore({ ...FRESH, expiry_ms: Date.now() + 30_000 }), fn);
    expect(await auth.getAccessToken()).toBe("access-new");
    expect(calls).toHaveLength(1);
  });

  it("refreshes when there is no access token even though the expiry is in the future", async () => {
    const { fn, calls } = fakeFetch(() => tokenResponse());
    const auth = new CliDriveAuth(CLIENT, new MemoryTokenStore({ ...FRESH, access_token: "" }), fn);
    expect(await auth.getAccessToken()).toBe("access-new");
    expect(calls).toHaveLength(1);
  });

  it("does not refresh twice once the new token is valid", async () => {
    const { fn, calls } = fakeFetch(() => tokenResponse());
    const auth = new CliDriveAuth(CLIENT, new MemoryTokenStore({ ...EXPIRED }), fn);
    await auth.getAccessToken();
    await auth.getAccessToken();
    expect(calls).toHaveLength(1);
  });

  it("keeps the refresh token when Google does not send a new one, and replaces it when it does", async () => {
    const store = new MemoryTokenStore({ ...EXPIRED });
    let next: Record<string, unknown> = {};
    const { fn } = fakeFetch(() => tokenResponse(next));
    const auth = new CliDriveAuth(CLIENT, store, fn);
    await auth.getAccessToken();
    expect(store.tokens!.refresh_token).toBe("refresh-1");

    store.tokens = { ...EXPIRED };
    const second = new CliDriveAuth(CLIENT, store, fn);
    next = { refresh_token: "refresh-rotated" };
    await second.getAccessToken();
    expect(store.tokens!.refresh_token).toBe("refresh-rotated");
  });

  it("omits client_secret for a client without one", async () => {
    const { fn, calls } = fakeFetch(() => tokenResponse());
    const auth = new CliDriveAuth({ clientId: "cid", clientSecret: "" }, new MemoryTokenStore({ ...EXPIRED }), fn);
    await auth.getAccessToken();
    expect(calls[0]!.body.has("client_secret")).toBe(false);
    expect(calls[0]!.body.get("client_id")).toBe("cid");
  });

  it.each([400, 401])("clears the tokens and demands a new sign-in on invalid_grant (HTTP %i)", async (status) => {
    const store = new MemoryTokenStore({ ...EXPIRED });
    const { fn } = fakeFetch(() => new Response('{"error":"invalid_grant","error_description":"Token has been expired or revoked."}', { status }));
    const auth = new CliDriveAuth(CLIENT, store, fn);

    await expect(auth.getAccessToken()).rejects.toBeInstanceOf(ReauthRequiredError);

    expect(store.cleared).toBe(1);
    expect(store.tokens).toBeNull();
    expect(auth.isAuthenticated()).toBe(false);
  });

  it.each([
    [400, '{"error":"invalid_request"}'],
    [500, "internal error"],
    [403, '{"error":"access_denied"}'],
  ])("keeps the tokens on a transient or other error (HTTP %i)", async (status, body) => {
    const store = new MemoryTokenStore({ ...EXPIRED });
    const { fn } = fakeFetch(() => new Response(body, { status }));
    const auth = new CliDriveAuth(CLIENT, store, fn);

    const error = await auth.getAccessToken().catch((e: unknown) => e);

    expect(error).not.toBeInstanceOf(ReauthRequiredError);
    expect((error as Error).message).toContain(`Google token request failed: HTTP ${status}`);
    expect(store.cleared).toBe(0);
    expect(auth.isAuthenticated()).toBe(true);
  });

  it("fails clearly when a refresh is needed but no OAuth client is configured", async () => {
    const auth = new CliDriveAuth(undefined, new MemoryTokenStore({ ...EXPIRED }));
    await expect(auth.getAccessToken()).rejects.toThrow(/No Google OAuth client configured/);
  });
});

describe("CliDriveAuth.revoke", () => {
  it("revokes the refresh token at Google and forgets the tokens", async () => {
    const store = new MemoryTokenStore({ ...FRESH, refresh_token: "refresh/with+chars" });
    const { fn, calls } = fakeFetch(() => new Response("", { status: 200 }));
    const auth = new CliDriveAuth(CLIENT, store, fn);

    await auth.revoke();

    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.url).toBe(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent("refresh/with+chars")}`);
    expect(store.tokens).toBeNull();
    expect(store.cleared).toBe(1);
    expect(auth.isAuthenticated()).toBe(false);
  });

  it("still signs out when Google cannot be reached", async () => {
    const store = new MemoryTokenStore({ ...FRESH });
    const auth = new CliDriveAuth(CLIENT, store, (async () => { throw new Error("offline"); }) as typeof fetch);
    await expect(auth.revoke()).resolves.toBeUndefined();
    expect(store.tokens).toBeNull();
    expect(auth.isAuthenticated()).toBe(false);
  });

  it("does not call Google when nobody is signed in, but still clears the store", async () => {
    const store = new MemoryTokenStore();
    const { fn, calls } = fakeFetch(() => new Response(""));
    await new CliDriveAuth(CLIENT, store, fn).revoke();
    expect(calls).toEqual([]);
    expect(store.cleared).toBe(1);
  });
});

describe("CliDriveAuth.login (PKCE loopback flow)", () => {
  interface Browser {
    urls: string[];
    statuses: number[];
    bodies: string[];
    done: Promise<void>;
    open: (url: string) => void;
  }

  /** An "openBrowser" that plays the user's browser: calls the redirect_uri with whatever `visits` returns. */
  function browser(visits: (authUrl: URL) => string[]): Browser {
    const urls: string[] = [];
    const statuses: number[] = [];
    const bodies: string[] = [];
    let finish!: () => void;
    let fail!: (e: unknown) => void;
    const done = new Promise<void>((resolve, reject) => { finish = resolve; fail = reject; });
    return {
      urls, statuses, bodies, done,
      open(url: string) {
        urls.push(url);
        void (async () => {
          const authUrl = new URL(url);
          const redirect = authUrl.searchParams.get("redirect_uri")!;
          for (const suffix of visits(authUrl)) {
            const res = await httpGet(`${redirect}${suffix}`);
            statuses.push(res.status);
            bodies.push(res.body);
          }
        })().then(finish, fail);
      },
    };
  }

  function exchangeFetch(body: Record<string, unknown> = { refresh_token: "refresh-from-login" }): ReturnType<typeof fakeFetch> {
    return fakeFetch(() => tokenResponse({ access_token: "access-from-login", ...body }));
  }

  it("opens an S256 PKCE authorization URL on a 127.0.0.1 redirect, exchanges the code and stores the tokens", async () => {
    const store = new MemoryTokenStore();
    const { fn, calls } = exchangeFetch();
    const auth = new CliDriveAuth(CLIENT, store, fn);
    const given: string[] = [];
    const b = browser((u) => [`/?code=abc&state=${u.searchParams.get("state")}`]);
    const before = Date.now();

    await auth.login({ openBrowser: b.open, onUrl: (url) => given.push(url) });
    await b.done;

    // The authorization request.
    expect(b.urls).toHaveLength(1);
    expect(given).toEqual(b.urls);
    const url = new URL(b.urls[0]!);
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe(CLIENT.clientId);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(url.searchParams.get("redirect_uri")).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("scope")!.split(" ")).toEqual([
      "https://www.googleapis.com/auth/drive.file", "https://www.googleapis.com/auth/drive.appdata",
    ]);

    // The browser got a friendly page.
    expect(b.statuses).toEqual([200]);
    expect(b.bodies[0]).toContain("connected to Google Drive");

    // The code exchange proves possession of the verifier behind the challenge.
    expect(calls).toHaveLength(1);
    const exchange = Object.fromEntries(calls[0]!.body);
    expect(exchange).toMatchObject({
      grant_type: "authorization_code", code: "abc", redirect_uri: url.searchParams.get("redirect_uri"),
      client_id: CLIENT.clientId, client_secret: "csecret",
    });
    expect(base64url(crypto.createHash("sha256").update(exchange["code_verifier"]!).digest())).toBe(url.searchParams.get("code_challenge"));

    // The tokens were stored and are in use.
    expect(store.saves).toHaveLength(1);
    expect(store.tokens).toMatchObject({ access_token: "access-from-login", refresh_token: "refresh-from-login" });
    expect(store.tokens!.expiry_ms).toBeGreaterThanOrEqual(before + 3_600_000);
    expect(auth.isAuthenticated()).toBe(true);
    expect(await auth.getAccessToken()).toBe("access-from-login");
    expect(calls).toHaveLength(1);
  });

  it("uses a fresh verifier, challenge and state for every login", async () => {
    const challenges: string[] = [];
    const states: string[] = [];
    for (let i = 0; i < 2; i++) {
      const auth = new CliDriveAuth(CLIENT, new MemoryTokenStore(), exchangeFetch().fn);
      const b = browser((u) => [`/?code=c&state=${u.searchParams.get("state")}`]);
      await auth.login({ openBrowser: b.open });
      await b.done;
      const url = new URL(b.urls[0]!);
      challenges.push(url.searchParams.get("code_challenge")!);
      states.push(url.searchParams.get("state")!);
    }
    expect(new Set(challenges).size).toBe(2);
    expect(new Set(states).size).toBe(2);
  });

  it("rejects a redirect with the wrong state (HTTP 400) and keeps waiting for the real one", async () => {
    const store = new MemoryTokenStore();
    const { fn, calls } = exchangeFetch();
    const auth = new CliDriveAuth(CLIENT, store, fn);
    const b = browser((u) => ["/?code=evil&state=forged", `/?code=good&state=${u.searchParams.get("state")}`]);

    await auth.login({ openBrowser: b.open });
    await b.done;

    expect(b.statuses).toEqual([400, 200]);
    expect(b.bodies[0]).toContain("does not belong to the running login");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body.get("code")).toBe("good");
    expect(store.tokens?.refresh_token).toBe("refresh-from-login");
  });

  it("rejects a redirect without a state at all", async () => {
    const { fn, calls } = exchangeFetch();
    const auth = new CliDriveAuth(CLIENT, new MemoryTokenStore(), fn);
    const b = browser((u) => ["/?code=nostate", `/?code=ok&state=${u.searchParams.get("state")}`]);
    await auth.login({ openBrowser: b.open });
    await b.done;
    expect(b.statuses).toEqual([400, 200]);
    expect(calls[0]!.body.get("code")).toBe("ok");
  });

  it("ignores requests that carry neither a code nor an error (a favicon fetch)", async () => {
    const auth = new CliDriveAuth(CLIENT, new MemoryTokenStore(), exchangeFetch().fn);
    const b = browser((u) => ["/favicon.ico", `/?code=abc&state=${u.searchParams.get("state")}`]);
    await auth.login({ openBrowser: b.open });
    await b.done;
    expect(b.statuses).toEqual([204, 200]);
  });

  it("fails and stores nothing when the user cancels (error=access_denied)", async () => {
    const store = new MemoryTokenStore();
    const { fn, calls } = exchangeFetch();
    const auth = new CliDriveAuth(CLIENT, store, fn);
    const b = browser((u) => [`/?error=access_denied&state=${u.searchParams.get("state")}`]);

    await expect(auth.login({ openBrowser: b.open })).rejects.toThrow("Sign-in cancelled (access_denied)");
    await b.done;

    expect(b.bodies[0]).toContain("cancelled");
    expect(calls).toEqual([]);
    expect(store.saves).toEqual([]);
    expect(auth.isAuthenticated()).toBe(false);
  });

  it("times out when the browser never calls back, and closes its server", async () => {
    const store = new MemoryTokenStore();
    const auth = new CliDriveAuth(CLIENT, store, exchangeFetch().fn);
    let redirect = "";

    await expect(auth.login({
      timeoutMs: 80,
      openBrowser: () => undefined,
      onUrl: (url) => { redirect = new URL(url).searchParams.get("redirect_uri")!; },
    })).rejects.toThrow("Sign-in timed out");

    expect(store.saves).toEqual([]);
    await expect(httpGet(`${redirect}/?code=late&state=x`)).rejects.toThrow(/ECONNREFUSED/);
  });

  it("carries on when the browser cannot be launched (the URL was handed to onUrl)", async () => {
    const auth = new CliDriveAuth(CLIENT, new MemoryTokenStore(), exchangeFetch().fn);
    const b = browser((u) => [`/?code=abc&state=${u.searchParams.get("state")}`]);
    await auth.login({
      openBrowser: () => { throw new Error("no browser installed"); },
      onUrl: (url) => b.open(url),
    });
    await b.done;
    expect(auth.isAuthenticated()).toBe(true);
  });

  it("fails when Google returns no refresh token, without storing anything", async () => {
    const store = new MemoryTokenStore();
    const auth = new CliDriveAuth(CLIENT, store, exchangeFetch({ refresh_token: undefined }).fn);
    const b = browser((u) => [`/?code=abc&state=${u.searchParams.get("state")}`]);
    await expect(auth.login({ openBrowser: b.open })).rejects.toThrow(/did not return a refresh token/);
    await b.done;
    expect(store.saves).toEqual([]);
    expect(auth.isAuthenticated()).toBe(false);
  });

  it("surfaces a failed code exchange", async () => {
    const store = new MemoryTokenStore();
    const { fn } = fakeFetch(() => new Response('{"error":"invalid_client"}', { status: 401 }));
    const auth = new CliDriveAuth(CLIENT, store, fn);
    const b = browser((u) => [`/?code=abc&state=${u.searchParams.get("state")}`]);
    await expect(auth.login({ openBrowser: b.open })).rejects.toThrow(/Google token request failed: HTTP 401/);
    await b.done;
    expect(store.saves).toEqual([]);
  });

  it("refuses to start without an OAuth client, opening no browser", async () => {
    const open = jest.fn();
    await expect(new CliDriveAuth(undefined, new MemoryTokenStore()).login({ openBrowser: open })).rejects.toThrow(/No Google OAuth client configured/);
    expect(open).not.toHaveBeenCalled();
  });
});
