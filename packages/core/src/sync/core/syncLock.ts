/**
 * Cross-process lock around a sync run. The VS Code extension and the terminal app sync the same local library with
 * the same manifest file, so two runs at once would race on the manifest and on the files themselves. The lock is a
 * small JSON file created exclusively next to the manifest; a holder refreshes its heartbeat while it works, and a lock
 * whose heartbeat stopped (crash, killed process) is taken over.
 */
import type { LockStore } from "../../ports/index.js";

/** Who is syncing: shown to the other app while it waits. */
export interface SyncLockOwner {
  /** "vscode", "terminal", … */
  app: string;
  pid: number;
  host: string;
}

/** The lock file's content. */
export interface SyncLockInfo extends SyncLockOwner {
  token: string;
  acquiredAt: string;
  heartbeatAt: string;
}

export interface SyncLockOptions {
  /** A lock whose heartbeat is older than this is abandoned. Default 2 minutes. */
  staleMs?: number;
  /** How often a holder refreshes its heartbeat. Default 20 seconds. */
  heartbeatMs?: number;
  now?: () => Date;
  newToken?: () => string;
  /** Liveness check for holders on this host; when it says false the lock is abandoned at once. */
  isProcessAlive?: (pid: number) => boolean;
}

export type SyncLockAttempt =
  | { acquired: true; lock: HeldSyncLock }
  | { acquired: false; holder: SyncLockInfo | undefined };

const DEFAULT_STALE_MS = 120_000;
const DEFAULT_HEARTBEAT_MS = 20_000;

/**
 * Parses a lock file, tolerating garbage (a half-written or hand-edited file reads as no holder).
 * @usedBy SyncLock, HeldSyncLock
 * @returns the lock info, or undefined
 */
export function parseSyncLock(text: string | undefined): SyncLockInfo | undefined {
  if (!text) { return undefined; }
  try {
    const raw = JSON.parse(text) as Partial<SyncLockInfo>;
    if (typeof raw.token !== "string" || typeof raw.heartbeatAt !== "string" || typeof raw.pid !== "number") {
      return undefined;
    }
    return {
      app: typeof raw.app === "string" ? raw.app : "unknown",
      pid: raw.pid,
      host: typeof raw.host === "string" ? raw.host : "",
      token: raw.token,
      acquiredAt: typeof raw.acquiredAt === "string" ? raw.acquiredAt : raw.heartbeatAt,
      heartbeatAt: raw.heartbeatAt,
    };
  } catch {
    return undefined;
  }
}

/**
 * Acquires the sync lock of one library. One instance per (library, provider) is enough; acquire() may be called
 * repeatedly, each successful call returning its own HeldSyncLock.
 * @usedBy @labshelf/vscode syncController, @labshelf/terminal syncService
 */
export class SyncLock {
  private readonly staleMs: number;
  readonly heartbeatMs: number;
  private readonly now: () => Date;
  private readonly newToken: () => string;

  constructor(
    private readonly store: LockStore,
    private readonly path: string,
    private readonly owner: SyncLockOwner,
    private readonly options: SyncLockOptions = {},
  ) {
    this.staleMs = options.staleMs ?? DEFAULT_STALE_MS;
    this.heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
    this.now = options.now ?? (() => new Date());
    this.newToken = options.newToken ?? (() => globalThis.crypto.randomUUID());
  }

  /**
   * Tries to take the lock once, taking over an abandoned one.
   * @usedBy runExclusive, callers that want to report who holds the lock
   * @returns the held lock, or the current holder when it is busy
   */
  async acquire(): Promise<SyncLockAttempt> {
    const first = await this.tryCreate();
    if (first) { return { acquired: true, lock: first }; }

    const holder = parseSyncLock(await this.store.read(this.path));
    if (holder && !this.isAbandoned(holder)) {
      return { acquired: false, holder };
    }
    // Abandoned or unreadable: remove it, but only if it is still the same file we judged.
    const again = parseSyncLock(await this.store.read(this.path));
    if (again && holder && again.token !== holder.token) {
      return { acquired: false, holder: again };
    }
    await this.store.remove(this.path);
    const second = await this.tryCreate();
    if (second) { return { acquired: true, lock: second }; }
    return { acquired: false, holder: parseSyncLock(await this.store.read(this.path)) };
  }

  /**
   * Runs task while holding the lock, refreshing the heartbeat in the background and releasing it afterwards.
   * @usedBy @labshelf/vscode syncController, @labshelf/terminal syncService
   * @returns the task's result, or the holder when the lock is busy
   */
  async runExclusive<T>(task: () => Promise<T>): Promise<{ ran: true; value: T } | { ran: false; holder: SyncLockInfo | undefined }> {
    const attempt = await this.acquire();
    if (!attempt.acquired) { return { ran: false, holder: attempt.holder }; }
    const { lock } = attempt;
    const timer = setInterval(() => { void lock.heartbeat().catch(() => undefined); }, this.heartbeatMs);
    // A pending heartbeat must not keep a CLI process alive after its work is done.
    (timer as { unref?: () => void }).unref?.();
    try {
      return { ran: true, value: await task() };
    } finally {
      clearInterval(timer);
      await lock.release().catch(() => undefined);
    }
  }

  /**
   * Whether a holder stopped working: its heartbeat is too old, or it ran on this host and its process is gone.
   * @usedBy acquire
   * @returns true when the lock can be taken over
   */
  isAbandoned(holder: SyncLockInfo): boolean {
    // On this host the process table is the truth: a holder that is stopped (Ctrl-Z) or was asleep has a stale
    // heartbeat but is still mid-run, and would resume writing the manifest after a takeover.
    if (holder.host === this.owner.host && this.options.isProcessAlive) {
      return !this.options.isProcessAlive(holder.pid);
    }
    const beat = Date.parse(holder.heartbeatAt);
    return !Number.isFinite(beat) || this.now().getTime() - beat > this.staleMs;
  }

  private async tryCreate(): Promise<HeldSyncLock | undefined> {
    const stamp = this.now().toISOString();
    const info: SyncLockInfo = { ...this.owner, token: this.newToken(), acquiredAt: stamp, heartbeatAt: stamp };
    if (!(await this.store.createExclusive(this.path, JSON.stringify(info, null, 2)))) {
      return undefined;
    }
    return new HeldSyncLock(this.store, this.path, info, this.now);
  }
}

/** A lock this process holds. */
export class HeldSyncLock {
  constructor(
    private readonly store: LockStore,
    private readonly path: string,
    private info: SyncLockInfo,
    private readonly now: () => Date,
  ) {}

  get token(): string {
    return this.info.token;
  }

  /**
   * Refreshes the heartbeat, unless another process took the lock over meanwhile.
   * @usedBy SyncLock.runExclusive
   * @returns true while the lock is still ours
   */
  async heartbeat(): Promise<boolean> {
    const current = parseSyncLock(await this.store.read(this.path));
    if (current?.token !== this.info.token) { return false; }
    this.info = { ...this.info, heartbeatAt: this.now().toISOString() };
    await this.store.write(this.path, JSON.stringify(this.info, null, 2));
    return true;
  }

  /**
   * Removes the lock file if it is still ours.
   * @usedBy SyncLock.runExclusive
   * @returns void
   */
  async release(): Promise<void> {
    const current = parseSyncLock(await this.store.read(this.path));
    if (current?.token === this.info.token) {
      await this.store.remove(this.path);
    }
  }
}
