import { SyncLock, parseSyncLock, type LockStore } from "@labshelf/core";

/** In-memory LockStore with an atomic exclusive create. */
class MemoryLockStore implements LockStore {
  files = new Map<string, string>();
  async createExclusive(path: string, text: string): Promise<boolean> {
    if (this.files.has(path)) return false;
    this.files.set(path, text);
    return true;
  }
  async read(path: string): Promise<string | undefined> {
    return this.files.get(path);
  }
  async write(path: string, text: string): Promise<void> {
    this.files.set(path, text);
  }
  async remove(path: string): Promise<void> {
    this.files.delete(path);
  }
}

const PATH = "/lib/.research/sync/google-drive.lock";
const vscode = { app: "vscode", pid: 100, host: "laptop" };
const terminal = { app: "terminal", pid: 200, host: "laptop" };

function clock(start: string): { now: () => Date; advance: (ms: number) => void } {
  let t = Date.parse(start);
  return { now: () => new Date(t), advance: (ms) => { t += ms; } };
}

describe("SyncLock", () => {
  it("lets one app hold the lock and reports it to the other", async () => {
    const store = new MemoryLockStore();
    const c = clock("2026-10-08T10:00:00Z");
    const first = await new SyncLock(store, PATH, vscode, { now: c.now }).acquire();
    expect(first.acquired).toBe(true);

    const second = await new SyncLock(store, PATH, terminal, { now: c.now }).acquire();
    expect(second.acquired).toBe(false);
    if (!second.acquired) {
      expect(second.holder?.app).toBe("vscode");
      expect(second.holder?.pid).toBe(100);
    }
  });

  it("releases only its own lock", async () => {
    const store = new MemoryLockStore();
    const attempt = await new SyncLock(store, PATH, vscode).acquire();
    if (!attempt.acquired) throw new Error("expected the lock");
    store.files.set(PATH, JSON.stringify({ ...terminal, token: "other", acquiredAt: "x", heartbeatAt: new Date().toISOString() }));
    await attempt.lock.release();
    expect(parseSyncLock(store.files.get(PATH))?.token).toBe("other");
  });

  it("takes over a lock whose heartbeat stopped", async () => {
    const store = new MemoryLockStore();
    const c = clock("2026-10-08T10:00:00Z");
    await new SyncLock(store, PATH, { ...vscode, host: "desktop" }, { now: c.now }).acquire();
    c.advance(5 * 60_000);
    const attempt = await new SyncLock(store, PATH, terminal, { now: c.now, staleMs: 120_000 }).acquire();
    expect(attempt.acquired).toBe(true);
    expect(parseSyncLock(store.files.get(PATH))?.app).toBe("terminal");
  });

  it("takes over at once when the holder's process on this host is gone", async () => {
    const store = new MemoryLockStore();
    await new SyncLock(store, PATH, vscode).acquire();
    const attempt = await new SyncLock(store, PATH, terminal, { isProcessAlive: (pid) => pid !== 100 }).acquire();
    expect(attempt.acquired).toBe(true);
  });

  it("does not take over a live holder on another host", async () => {
    const store = new MemoryLockStore();
    await new SyncLock(store, PATH, { ...vscode, host: "desktop" }).acquire();
    const attempt = await new SyncLock(store, PATH, terminal, { isProcessAlive: () => false }).acquire();
    expect(attempt.acquired).toBe(false);
  });

  it("treats an unreadable lock file as abandoned", async () => {
    const store = new MemoryLockStore();
    store.files.set(PATH, "{ half a json");
    const attempt = await new SyncLock(store, PATH, terminal).acquire();
    expect(attempt.acquired).toBe(true);
  });

  it("refreshes the heartbeat while held and stops once taken over", async () => {
    const store = new MemoryLockStore();
    const c = clock("2026-10-08T10:00:00Z");
    const attempt = await new SyncLock(store, PATH, terminal, { now: c.now }).acquire();
    if (!attempt.acquired) throw new Error("expected the lock");
    c.advance(10_000);
    expect(await attempt.lock.heartbeat()).toBe(true);
    expect(parseSyncLock(store.files.get(PATH))?.heartbeatAt).toBe("2026-10-08T10:00:10.000Z");
    store.files.set(PATH, JSON.stringify({ ...vscode, token: "thief", acquiredAt: "x", heartbeatAt: "x" }));
    expect(await attempt.lock.heartbeat()).toBe(false);
  });

  it("runExclusive runs the task, releases afterwards, and reports a busy lock", async () => {
    const store = new MemoryLockStore();
    const lock = new SyncLock(store, PATH, terminal);
    const result = await lock.runExclusive(async () => {
      expect(store.files.has(PATH)).toBe(true);
      return 42;
    });
    expect(result).toEqual({ ran: true, value: 42 });
    expect(store.files.has(PATH)).toBe(false);

    await new SyncLock(store, PATH, vscode).acquire();
    const busy = await lock.runExclusive(async () => 1);
    expect(busy.ran).toBe(false);
  });

  it("releases the lock when the task throws", async () => {
    const store = new MemoryLockStore();
    const lock = new SyncLock(store, PATH, terminal);
    await expect(lock.runExclusive(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(store.files.has(PATH)).toBe(false);
  });
});

describe("parseSyncLock", () => {
  it("rejects files without a token, pid or heartbeat", () => {
    expect(parseSyncLock(undefined)).toBeUndefined();
    expect(parseSyncLock("{}")).toBeUndefined();
    expect(parseSyncLock(JSON.stringify({ token: "t", pid: 1 }))).toBeUndefined();
  });

  it("fills defaults for optional fields", () => {
    const info = parseSyncLock(JSON.stringify({ token: "t", pid: 1, heartbeatAt: "2026-01-01T00:00:00Z" }));
    expect(info).toMatchObject({ app: "unknown", host: "", acquiredAt: "2026-01-01T00:00:00Z" });
  });
});

describe("SyncLock on one host", () => {
  it("does not take over a live holder whose heartbeat is old (suspended with Ctrl-Z, or the laptop slept)", async () => {
    const store = new MemoryLockStore();
    const c = clock("2026-10-08T10:00:00Z");
    await new SyncLock(store, PATH, terminal, { now: c.now }).acquire();
    c.advance(30 * 60_000);
    const attempt = await new SyncLock(store, PATH, vscode, { now: c.now, isProcessAlive: () => true }).acquire();
    expect(attempt.acquired).toBe(false);
  });
});
