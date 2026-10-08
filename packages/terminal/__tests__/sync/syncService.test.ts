import { spawnSync } from "node:child_process";
import * as http from "node:http";
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { PaperDataStore } from "@labshelf/reader";
import { stringify } from "yaml";
import type { RemoteProvider, SyncLockInfo, SyncResult, SyncRunRecord } from "@labshelf/core";

import { LibraryStore } from "../../src/library/libraryStore";
import { NodeSidecarPort } from "../../src/library/sidecars";
import { CliDriveAuth, ReauthRequiredError } from "../../src/sync/driveAuth";
import { SyncService, libraryChanged, type SyncOutcome, type SyncStatus } from "../../src/sync/syncService";
import { FakeRemoteProvider, MemoryTokenStore } from "../fixtures/fakeRemote";
import {
  cleanupTempDirs,
  createTempLibrary,
  listFiles,
  pathExists,
  readYaml,
  type PaperFixture,
  type TempLibrary,
} from "../fixtures/library";

afterEach(async () => {
  jest.useRealTimers();
  await cleanupTempDirs();
});

const ID = "vaswani2017attention";
const TITLE = "Attention Is All You Need";
const VALID_TOKENS = () => ({ access_token: "access", refresh_token: "refresh", expiry_ms: Date.now() + 3_600_000 });
const CLIENT = { clientId: "cid.apps.googleusercontent.com", clientSecret: "secret" };

function annotation(id: string, pageNumber: number, content: string): Record<string, unknown> {
  const stamp = `2025-01-0${pageNumber}T00:00:00.000Z`;
  return {
    id, paperId: ID, type: "highlight", pageNumber, content, color: "yellow",
    position: { x: 0.1, y: 0.1, width: 0.2, height: 0.05 }, createdAt: stamp, updatedAt: stamp,
  };
}

const PAPER: PaperFixture = {
  id: ID,
  collection: "ML",
  title: TITLE,
  pdf: true,
  bib: true,
  meta: { authors: ["Ashish Vaswani"], year: 2017, status: "reading" },
  sidecar: { annotations: [annotation("a1", 1, "self-attention replaces recurrence")], theme: "dark" },
};

interface Device {
  lib: TempLibrary;
  store: LibraryStore;
  tokens: MemoryTokenStore;
  auth: CliDriveAuth;
  service: SyncService;
  factory: jest.Mock<RemoteProvider, []>;
  logs: Array<{ level: string; message: string }>;
  statuses: SyncStatus[];
}

interface DeviceOptions {
  papers?: PaperFixture[];
  remote?: FakeRemoteProvider;
  host?: string;
  tokens?: MemoryTokenStore;
  client?: typeof CLIENT | undefined;
  authFetch?: typeof fetch;
}

async function device(options: DeviceOptions = {}): Promise<Device> {
  const lib = await createTempLibrary(options.papers ?? []);
  const store = new LibraryStore(lib.paths);
  await store.reload();
  const tokens = options.tokens ?? new MemoryTokenStore(VALID_TOKENS());
  const noNetwork = (async () => { throw new Error("unexpected network call from the auth layer"); }) as typeof fetch;
  const client = "client" in options ? options.client : CLIENT;
  const auth = new CliDriveAuth(client, tokens, options.authFetch ?? noNetwork);
  const remote = options.remote ?? new FakeRemoteProvider();
  const factory = jest.fn((): RemoteProvider => remote);
  const logs: Array<{ level: string; message: string }> = [];
  const service = new SyncService({
    paths: lib.paths,
    auth,
    store,
    logger: { log: async (level, _module, message) => { logs.push({ level, message }); }, error: async () => undefined },
    providerFactory: factory,
    host: options.host ?? "host-a",
  });
  const statuses: SyncStatus[] = [];
  service.onStatus((s) => statuses.push(s));
  await service.init();
  return { lib, store, tokens, auth, service, factory, logs, statuses };
}

function expectSynced(outcome: SyncOutcome): Extract<SyncOutcome, { kind: "synced" }> {
  if (outcome.kind !== "synced") { throw new Error(`expected a synced outcome, got ${JSON.stringify(outcome)}`); }
  return outcome;
}

function lockInfo(overrides: Partial<SyncLockInfo> = {}): SyncLockInfo {
  const now = new Date().toISOString();
  return { app: "vscode", pid: 424242, host: "other-host", token: "foreign-token", acquiredAt: now, heartbeatAt: now, ...overrides };
}

async function writeLock(d: Device, content: SyncLockInfo | string): Promise<void> {
  await fs.mkdir(d.lib.paths.syncDir(), { recursive: true });
  await fs.writeFile(d.lib.paths.lockPath(), typeof content === "string" ? content : JSON.stringify(content, null, 2));
}

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await fs.readFile(file, "utf8")) as T;
}

async function until(condition: () => boolean, attempts = 400): Promise<void> {
  for (let i = 0; i < attempts && !condition(); i++) { await new Promise((resolve) => setImmediate(resolve)); }
  if (!condition()) { throw new Error("condition not reached"); }
}

function httpGet(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    http.get(url, { agent: false, headers: { Connection: "close" } }, (res) => { res.resume(); res.on("end", () => resolve(res.statusCode ?? 0)); })
      .on("error", reject);
  });
}

describe("libraryChanged", () => {
  const ns = (over: Partial<SyncResult["namespaces"][number]> = {}): SyncResult["namespaces"][number] => ({
    namespace: "library", uploaded: 0, downloaded: 0, deletedLocal: 0, deletedRemote: 0, conflicts: [], ...over,
  });
  const result = (...namespaces: SyncResult["namespaces"]): SyncResult => ({ providerId: "p", namespaces, startedAt: "", finishedAt: "" });

  it("is true when something was downloaded, deleted locally, or conflicted", () => {
    expect(libraryChanged(result(ns({ downloaded: 1 })))).toBe(true);
    expect(libraryChanged(result(ns(), ns({ namespace: "appdata", deletedLocal: 2 })))).toBe(true);
    expect(libraryChanged(result(ns({ conflicts: ["a/b.yaml"] })))).toBe(true);
  });

  it("is false when the run only uploaded or deleted remotely (the local library did not change)", () => {
    expect(libraryChanged(result(ns({ uploaded: 5, deletedRemote: 2 })))).toBe(false);
    expect(libraryChanged(result())).toBe(false);
    expect(libraryChanged(result(ns(), ns({ namespace: "appdata" })))).toBe(false);
  });
});

describe("SyncService.init and status", () => {
  it("is idle when a client is configured and tokens exist", async () => {
    const d = await device();
    expect(d.service.status().state).toBe("idle");
  });

  it("is disconnected without tokens and unconfigured without a client", async () => {
    expect((await device({ tokens: new MemoryTokenStore() })).service.status().state).toBe("disconnected");
    expect((await device({ client: undefined })).service.status().state).toBe("unconfigured");
  });

  it("reads the last-run record written by another app", async () => {
    const lib = await createTempLibrary();
    const record: SyncRunRecord = {
      providerId: "google-drive", app: "vscode", host: "laptop", startedAt: "2025-05-01T10:00:00.000Z", finishedAt: "2025-05-01T10:00:05.000Z",
      uploaded: 1, downloaded: 2, deletedLocal: 0, deletedRemote: 0, conflicts: [],
    };
    await fs.writeFile(lib.paths.lastRunPath(), JSON.stringify(record));
    const store = new LibraryStore(lib.paths);
    const service = new SyncService({
      paths: lib.paths, auth: new CliDriveAuth(CLIENT, new MemoryTokenStore(VALID_TOKENS())), store,
      logger: { log: async () => undefined, error: async () => undefined },
    });
    const status = await service.init();
    expect(status.lastRun).toEqual(record);
  });

  it("ignores a corrupt last-run file", async () => {
    const lib = await createTempLibrary();
    await fs.writeFile(lib.paths.lastRunPath(), "{ broken");
    const service = new SyncService({
      paths: lib.paths, auth: new CliDriveAuth(CLIENT, new MemoryTokenStore(VALID_TOKENS())),
      logger: { log: async () => undefined, error: async () => undefined },
    });
    expect((await service.init()).lastRun).toBeUndefined();
  });

  it("refreshLastRun picks up a sync by another app and tells the listeners once", async () => {
    const d = await device();
    const before = d.statuses.length;
    const record: SyncRunRecord = {
      providerId: "google-drive", app: "vscode", host: "laptop", startedAt: "2025-05-01T10:00:00.000Z", finishedAt: "2025-05-01T10:00:05.000Z",
      uploaded: 0, downloaded: 0, deletedLocal: 0, deletedRemote: 0, conflicts: [],
    };
    await fs.writeFile(d.lib.paths.lastRunPath(), JSON.stringify(record));

    await d.service.refreshLastRun();
    await d.service.refreshLastRun();

    expect(d.service.status().lastRun).toEqual(record);
    expect(d.statuses.length - before).toBe(1);
  });
});

describe("SyncService.syncNow: uploading from this device", () => {
  it("uploads a new local paper under a title-named Drive folder and its sidecar by id", async () => {
    const remote = new FakeRemoteProvider();
    const d = await device({ papers: [PAPER], remote });

    const outcome = expectSynced(await d.service.syncNow());

    expect(outcome.record).toMatchObject({ app: "terminal", host: "host-a", providerId: "google-drive", uploaded: 4, downloaded: 0, deletedLocal: 0, deletedRemote: 0, conflicts: [] });
    expect(remote.folderPaths("library")).toEqual(["ML", `ML/${TITLE}`]);
    expect(remote.filePaths("library")).toEqual([`ML/${TITLE}/bib.bib`, `ML/${TITLE}/metadata.yaml`, `ML/${TITLE}/paper.pdf`]);
    expect(remote.folderPaths("appdata")).toEqual([ID]);
    expect(remote.filePaths("appdata")).toEqual([`${ID}/data.json`]);
    expect(remote.readText("library", `ML/${TITLE}/metadata.yaml`)).toBe(await fs.readFile(path.join(d.lib.paperDir(ID, "ML"), "metadata.yaml"), "utf8"));
    expect(remote.readText("appdata", `${ID}/data.json`)).toBe(await fs.readFile(d.lib.paths.paperDataPath(ID), "utf8"));
  });

  it("writes the shared manifest keyed by local (id-named) paths, as the VS Code extension does", async () => {
    const d = await device({ papers: [PAPER] });
    await d.service.syncNow();

    const manifest = await readJson<{ providerId: string; namespaces: Record<string, Record<string, { remoteId: string; contentHash: string; modifiedTime: string }>> }>(d.lib.paths.manifestPath());
    expect(manifest.providerId).toBe("google-drive");
    expect(Object.keys(manifest.namespaces["library"]!).sort()).toEqual([
      `ML/${ID}/bib.bib`, `ML/${ID}/metadata.yaml`, `ML/${ID}/paper.pdf`,
    ]);
    expect(Object.keys(manifest.namespaces["appdata"]!)).toEqual([`${ID}/data.json`]);
    for (const entry of Object.values(manifest.namespaces["library"]!)) {
      expect(entry.remoteId).toEqual(expect.any(String));
      expect(entry.contentHash).toMatch(/^[0-9a-f]{64}$/);
      expect(entry.modifiedTime).toEqual(expect.any(String));
    }
  });

  it("records the run in google-drive.last.json for every app (app: terminal)", async () => {
    const d = await device({ papers: [PAPER] });
    const before = Date.now();
    const outcome = expectSynced(await d.service.syncNow());

    const onDisk = await readJson<SyncRunRecord>(d.lib.paths.lastRunPath());
    expect(onDisk).toEqual(outcome.record);
    expect(onDisk).toMatchObject({ providerId: "google-drive", app: "terminal", host: "host-a", uploaded: 4, conflicts: [] });
    expect(Date.parse(onDisk.finishedAt)).toBeGreaterThanOrEqual(before - 1000);
    expect(Date.parse(onDisk.startedAt)).toBeLessThanOrEqual(Date.parse(onDisk.finishedAt));
    expect(d.service.status()).toMatchObject({ state: "idle", lastRun: outcome.record });
  });

  it("holds the shared lock while syncing and removes it afterwards", async () => {
    const remote = new FakeRemoteProvider();
    const d = await device({ papers: [PAPER], remote, host: "host-a" });
    let during: SyncLockInfo | undefined;
    let stateDuring: string | undefined;
    remote.onResolveRoot = async () => {
      during ??= await readJson<SyncLockInfo>(d.lib.paths.lockPath());
      stateDuring ??= d.service.status().state;
    };

    await d.service.syncNow();

    expect(during).toMatchObject({ app: "terminal", pid: process.pid, host: "host-a" });
    expect(during!.token).toEqual(expect.any(String));
    expect(Date.parse(during!.heartbeatAt)).not.toBeNaN();
    expect(stateDuring).toBe("syncing");
    expect(await pathExists(d.lib.paths.lockPath())).toBe(false);
    expect(await listFiles(d.lib.paths.syncDir())).toEqual(["google-drive.last.json", "google-drive.state.json"]);
  });

  it("reports syncing then idle to status listeners", async () => {
    const d = await device({ papers: [PAPER] });
    d.statuses.length = 0;
    await d.service.syncNow();
    expect(d.statuses.map((s) => s.state)).toEqual(["syncing", "idle"]);
  });

  it("leaves the local library and temp folder untouched and logs the run", async () => {
    const d = await device({ papers: [PAPER] });
    const before = await listFiles(d.lib.paths.papersRoot());
    await d.service.syncNow();
    expect(await listFiles(d.lib.paths.papersRoot())).toEqual(before);
    expect(await listFiles(d.lib.paths.tmpDir())).toEqual([]);
    expect(d.logs.map((l) => l.message)).toContain("Sync finished");
  });

  it("sends nothing the second time when nothing changed", async () => {
    const remote = new FakeRemoteProvider();
    const d = await device({ papers: [PAPER], remote });
    await d.service.syncNow();
    const uploadsAfterFirst = remote.uploads.length;

    const second = expectSynced(await d.service.syncNow());

    expect(second.record).toMatchObject({ uploaded: 0, downloaded: 0, deletedLocal: 0, deletedRemote: 0 });
    expect(remote.uploads.length).toBe(uploadsAfterFirst);
    expect(remote.removals).toEqual([]);
  });

  it("uploads a later edit in place, keeping the Drive folder it already has", async () => {
    const remote = new FakeRemoteProvider();
    const d = await device({ papers: [PAPER], remote });
    await d.service.syncNow();
    const file = path.join(d.lib.paperDir(ID, "ML"), "metadata.yaml");
    await fs.writeFile(file, stringify({ ...(await readYaml(file)), status: "done" }));

    const outcome = expectSynced(await d.service.syncNow());

    expect(outcome.record.uploaded).toBe(1);
    expect(remote.folderPaths("library")).toEqual(["ML", `ML/${TITLE}`]);
    expect(remote.readText("library", `ML/${TITLE}/metadata.yaml`)).toContain("status: done");
  });

  it("names a paper without a title after its id on Drive", async () => {
    const remote = new FakeRemoteProvider();
    const d = await device({ papers: [{ id: "notitle1", title: null, pdf: true }], remote });
    await d.service.syncNow();
    expect(remote.folderPaths("library")).toEqual(["notitle1"]);
  });

  it("takes slashes and control characters out of Drive folder names", async () => {
    const remote = new FakeRemoteProvider();
    const d = await device({ papers: [{ id: "weird1", title: "Input/Output: a\tstudy" }], remote });
    await d.service.syncNow();
    expect(remote.folderPaths("library")).toEqual(["Input/Output: a\tstudy".replace(/[/\t]/g, "")]);
  });
});

describe("SyncService.syncNow: two devices (the terminal on another computer, or VS Code)", () => {
  it("downloads a paper from the title-named Drive folder into a folder named after its citekey (the paper id)", async () => {
    const remote = new FakeRemoteProvider();
    const a = await device({ papers: [PAPER], remote, host: "host-a" });
    await a.service.syncNow();

    const b = await device({ remote, host: "host-b" });
    const outcome = expectSynced(await b.service.syncNow());

    expect(outcome.record).toMatchObject({ app: "terminal", host: "host-b", downloaded: 4, uploaded: 0 });
    // Id-named, in the same collection - not "Attention Is All You Need".
    const folder = b.lib.paperDir(ID, "ML");
    expect(await listFiles(b.lib.paths.papersRoot())).toEqual([`ML/${ID}/bib.bib`, `ML/${ID}/metadata.yaml`, `ML/${ID}/paper.pdf`]);
    expect(await pathExists(path.join(b.lib.paths.collectionDir("ML"), TITLE))).toBe(false);
    for (const name of ["metadata.yaml", "paper.pdf", "bib.bib"]) {
      expect(await fs.readFile(path.join(folder, name))).toEqual(await fs.readFile(path.join(a.lib.paperDir(ID, "ML"), name)));
    }
    // The sidecar lands where this device (and VS Code) reads it.
    expect(await fs.readFile(b.lib.paths.paperDataPath(ID), "utf8")).toBe(await fs.readFile(a.lib.paths.paperDataPath(ID), "utf8"));
    expect(await listFiles(b.lib.paths.paperDataRoot())).toEqual([`${ID}/data.json`]);
  });

  it("shows the downloaded paper in the library without a manual reload", async () => {
    const remote = new FakeRemoteProvider();
    const a = await device({ papers: [PAPER], remote });
    await a.service.syncNow();
    const b = await device({ remote, host: "host-b" });
    const changes = jest.fn();
    b.store.onChange(changes);

    await b.service.syncNow();

    expect(changes).toHaveBeenCalledTimes(1);
    expect(b.store.paper(ID)).toMatchObject({ collection: "ML" });
    expect(b.store.paper(ID)!.record).toMatchObject({ title: TITLE, citeKey: ID, status: "reading", hasPdf: true, year: 2017 });
  });

  it("does not reload the library when the run changed nothing locally", async () => {
    const remote = new FakeRemoteProvider();
    const a = await device({ papers: [PAPER], remote });
    const changes = jest.fn();
    a.store.onChange(changes);
    await a.service.syncNow();
    expect(changes).not.toHaveBeenCalled();
  });

  it("settles to nothing-to-do on both devices after the exchange", async () => {
    const remote = new FakeRemoteProvider();
    const a = await device({ papers: [PAPER], remote, host: "host-a" });
    await a.service.syncNow();
    const b = await device({ remote, host: "host-b" });
    await b.service.syncNow();
    const uploads = remote.uploads.length;

    const bAgain = expectSynced(await b.service.syncNow());
    const aAgain = expectSynced(await a.service.syncNow());

    expect(bAgain.record).toMatchObject({ uploaded: 0, downloaded: 0, deletedLocal: 0, deletedRemote: 0 });
    expect(aAgain.record).toMatchObject({ uploaded: 0, downloaded: 0, deletedLocal: 0, deletedRemote: 0 });
    expect(remote.uploads.length).toBe(uploads);
    expect(remote.removals).toEqual([]);
    expect(remote.folderPaths("library")).toEqual(["ML", `ML/${TITLE}`]);
  });

  it("carries sidecar edits both ways through the appdata namespace", async () => {
    const remote = new FakeRemoteProvider();
    const a = await device({ papers: [PAPER], remote, host: "host-a" });
    await a.service.syncNow();
    const b = await device({ remote, host: "host-b" });
    await b.service.syncNow();

    // B highlights something and syncs...
    const storeB = new PaperDataStore(new NodeSidecarPort(b.lib.paths));
    await storeB.addHighlight(ID, 2, "positional encodings", "green", { x: 0.1, y: 0.2, width: 0.3, height: 0.05 });
    expectSynced(await b.service.syncNow());
    expect(remote.readText("appdata", `${ID}/data.json`)).toContain("positional encodings");

    // ...A syncs and sees both highlights.
    const outcome = expectSynced(await a.service.syncNow());
    expect(outcome.record.downloaded).toBe(1);
    const onA = await readJson<{ annotations: Array<{ content: string }>; theme: string }>(a.lib.paths.paperDataPath(ID));
    expect(onA.annotations.map((x) => x.content).sort()).toEqual(["positional encodings", "self-attention replaces recurrence"]);
    expect(onA.theme).toBe("dark");
  });

  it("carries a status edit to the other device", async () => {
    const remote = new FakeRemoteProvider();
    const a = await device({ papers: [PAPER], remote, host: "host-a" });
    await a.service.syncNow();
    const b = await device({ remote, host: "host-b" });
    await b.service.syncNow();

    const file = path.join(b.lib.paperDir(ID, "ML"), "metadata.yaml");
    await fs.writeFile(file, stringify({ ...(await readYaml(file)), status: "done" }));
    await b.service.syncNow();
    await a.service.syncNow();

    expect(a.store.paper(ID)!.record.status).toBe("done");
    expect((await readYaml(path.join(a.lib.paperDir(ID, "ML"), "metadata.yaml")))["status"]).toBe("done");
  });

  it("keeps the same local folder when the title changes on the other device (no duplicate, no deletion)", async () => {
    const remote = new FakeRemoteProvider();
    const a = await device({ papers: [PAPER], remote, host: "host-a" });
    await a.service.syncNow();
    const b = await device({ remote, host: "host-b" });
    await b.service.syncNow();
    const newTitle = "Attention Is All You Need (v2, revised)";

    // A retitles the paper in metadata.yaml and syncs.
    const fileA = path.join(a.lib.paperDir(ID, "ML"), "metadata.yaml");
    await fs.writeFile(fileA, stringify({ ...(await readYaml(fileA)), title: newTitle }));
    await a.store.reload();
    const fromA = expectSynced(await a.service.syncNow());
    expect(fromA.record).toMatchObject({ uploaded: 1, deletedLocal: 0, deletedRemote: 0 });
    // The existing Drive folder is reused, not duplicated.
    expect(remote.filePaths("library").filter((p) => p.endsWith("metadata.yaml"))).toHaveLength(1);
    expect(remote.readText("library", `ML/${TITLE}/metadata.yaml`)).toContain(newTitle);

    // B syncs: same folder, new title, nothing deleted, nothing created under the new title.
    const fromB = expectSynced(await b.service.syncNow());
    expect(fromB.record).toMatchObject({ downloaded: 1, uploaded: 0, deletedLocal: 0, deletedRemote: 0 });
    expect(await listFiles(b.lib.paths.papersRoot())).toEqual([`ML/${ID}/bib.bib`, `ML/${ID}/metadata.yaml`, `ML/${ID}/paper.pdf`]);
    expect(b.store.paper(ID)!.record.title).toBe(newTitle);
    expect(b.store.snapshot.papers.size).toBe(1);
    expect(b.store.snapshot.duplicates).toEqual([]);
    expect(remote.removals).toEqual([]);
  });

  it("names a paper new to this device after its citekey even when the title changed before it first synced", async () => {
    const remote = new FakeRemoteProvider();
    const a = await device({ papers: [PAPER], remote, host: "host-a" });
    await a.service.syncNow();
    const fileA = path.join(a.lib.paperDir(ID, "ML"), "metadata.yaml");
    await fs.writeFile(fileA, stringify({ ...(await readYaml(fileA)), title: "A Completely Different Title" }));
    await a.service.syncNow();

    const b = await device({ remote, host: "host-b" });
    await b.service.syncNow();

    expect(await listFiles(b.lib.paths.papersRoot())).toEqual([`ML/${ID}/bib.bib`, `ML/${ID}/metadata.yaml`, `ML/${ID}/paper.pdf`]);
    expect(b.store.paper(ID)!.record.title).toBe("A Completely Different Title");
  });

  it("falls back to the Drive display name for a paper folder whose metadata.yaml has no usable citekey (documented limitation)", async () => {
    const remote = new FakeRemoteProvider();
    // No citekey key at all: the id of this paper is only its folder name on device A.
    const a = await device({ papers: [{ id: "legacy1", title: "Legacy Paper", rawMetadata: "title: Legacy Paper\nauthors: []\n" }], remote, host: "host-a" });
    await a.service.syncNow();
    const b = await device({ remote, host: "host-b" });
    await b.service.syncNow();
    expect(await listFiles(b.lib.paths.papersRoot())).toEqual(["Legacy Paper/metadata.yaml"]);
    expect([...b.store.snapshot.papers.keys()]).toEqual(["Legacy Paper"]);
  });

  it("never lets a hostile citekey in a remote metadata.yaml place files outside the library", async () => {
    const remote = new FakeRemoteProvider();
    const a = await device({ papers: [{ id: "legit1", title: "Evil Title", meta: { citekey: "../../escape" } }], remote, host: "host-a" });
    await a.service.syncNow();
    const b = await device({ remote, host: "host-b" });
    await b.service.syncNow();
    expect(await listFiles(b.lib.paths.papersRoot())).toEqual(["Evil Title/metadata.yaml"]);
    expect(await pathExists(path.join(path.dirname(b.lib.root), "escape"))).toBe(false);
  });

  it("propagates a deletion: the other device loses the files, the library no longer lists the paper", async () => {
    const remote = new FakeRemoteProvider();
    const a = await device({ papers: [PAPER, { id: "keeper1", title: "Keeper", collection: "ML" }], remote, host: "host-a" });
    await a.service.syncNow();
    const b = await device({ remote, host: "host-b" });
    await b.service.syncNow();
    expect(b.store.snapshot.papers.size).toBe(2);

    await fs.rm(a.lib.paperDir(ID, "ML"), { recursive: true });
    const fromA = expectSynced(await a.service.syncNow());
    expect(fromA.record.deletedRemote).toBe(3);
    const fromB = expectSynced(await b.service.syncNow());
    expect(fromB.record.deletedLocal).toBe(3);

    expect([...b.store.snapshot.papers.keys()]).toEqual(["keeper1"]);
    expect(remote.folderPaths("library").some((p) => p.endsWith("/Keeper"))).toBe(true);
  });

  it("keeps both versions when both devices edited the same file, and reports the conflict", async () => {
    const remote = new FakeRemoteProvider();
    const a = await device({ papers: [PAPER], remote, host: "host-a" });
    await a.service.syncNow();
    const b = await device({ remote, host: "host-b" });
    await b.service.syncNow();

    const fileA = path.join(a.lib.paperDir(ID, "ML"), "metadata.yaml");
    const fileB = path.join(b.lib.paperDir(ID, "ML"), "metadata.yaml");
    await fs.writeFile(fileA, stringify({ ...(await readYaml(fileA)), note: "note from A" }));
    await fs.writeFile(fileB, stringify({ ...(await readYaml(fileB)), note: "note from B" }));
    await a.service.syncNow();

    const outcome = expectSynced(await b.service.syncNow());

    expect(outcome.record.conflicts).toEqual([`ML/${ID}/metadata.yaml`]);
    expect(libraryChanged(outcome.result)).toBe(true);
    const names = (await listFiles(b.lib.paperDir(ID, "ML"))).filter((n) => n.startsWith("metadata"));
    expect(names).toHaveLength(2);
    expect(names.some((n) => /^metadata \(conflict \d{4}-\d{2}-\d{2}\)\.yaml$/.test(n))).toBe(true);
    expect((await readYaml(fileB))["note"]).toBe("note from B");
    expect(await readJson<SyncRunRecord>(b.lib.paths.lastRunPath())).toMatchObject({ conflicts: [`ML/${ID}/metadata.yaml`] });
  });
});

describe("SyncService.syncNow: the cross-app lock", () => {
  it("reports busy and leaves everything alone when a live holder from another app has the lock", async () => {
    const remote = new FakeRemoteProvider();
    const d = await device({ papers: [PAPER], remote });
    const foreign = lockInfo({ app: "vscode", host: "other-host", pid: 424242, token: "vscode-token" });
    await writeLock(d, foreign);

    const outcome = await d.service.syncNow();

    expect(outcome.kind).toBe("busy");
    if (outcome.kind === "busy") { expect(outcome.holder).toMatchObject({ app: "vscode", host: "other-host", token: "vscode-token" }); }
    expect(d.service.status().state).toBe("waiting");
    expect(d.service.status().holder).toMatchObject({ app: "vscode" });
    expect(remote.uploads).toEqual([]);
    expect(d.factory).not.toHaveBeenCalled();
    expect(await pathExists(d.lib.paths.manifestPath())).toBe(false);
    expect(await pathExists(d.lib.paths.lastRunPath())).toBe(false);
    // The other app's lock is untouched.
    expect(await readJson<SyncLockInfo>(d.lib.paths.lockPath())).toMatchObject({ app: "vscode", token: "vscode-token" });
    expect(d.logs.map((l) => l.message)).toContain("Sync skipped: another app is syncing this library");
  });

  it("stops showing the other app as syncing once its lock is gone", async () => {
    const d = await device({ papers: [PAPER] });
    await writeLock(d, lockInfo({ app: "vscode", host: "other-host", pid: 424242, token: "vscode-token" }));
    await d.service.syncNow();
    expect(d.service.status().state).toBe("waiting");
    await d.service.refreshLastRun();
    expect(d.service.status().state).toBe("waiting");
    await fs.rm(d.lib.paths.lockPath());
    await d.service.refreshLastRun();
    expect(d.service.status().state).toBe("idle");
    expect(d.service.status().holder).toBeUndefined();
  });

  it("is busy for a holder on this host while its process is alive", async () => {
    const d = await device({ papers: [PAPER], host: "host-a" });
    await writeLock(d, lockInfo({ app: "vscode", host: "host-a", pid: process.pid }));
    expect((await d.service.syncNow()).kind).toBe("busy");
  });

  it("takes over a lock whose holder process on this host is gone", async () => {
    const d = await device({ papers: [PAPER], host: "host-a" });
    const dead = spawnSync(process.execPath, ["-e", ""]).pid;
    await writeLock(d, lockInfo({ app: "vscode", host: "host-a", pid: dead }));

    expect(expectSynced(await d.service.syncNow()).record.app).toBe("terminal");
    expect(await pathExists(d.lib.paths.lockPath())).toBe(false);
  });

  it("takes over a stale lock (heartbeat older than two minutes) from another host", async () => {
    const remote = new FakeRemoteProvider();
    const d = await device({ papers: [PAPER], remote });
    await writeLock(d, lockInfo({ heartbeatAt: new Date(Date.now() - 10 * 60_000).toISOString() }));

    const outcome = expectSynced(await d.service.syncNow());

    expect(outcome.record.uploaded).toBe(4);
    expect(await pathExists(d.lib.paths.lockPath())).toBe(false);
  });

  it("treats a lock that is just under the staleness limit as still held", async () => {
    const d = await device({ papers: [PAPER] });
    await writeLock(d, lockInfo({ heartbeatAt: new Date(Date.now() - 60_000).toISOString() }));
    expect((await d.service.syncNow()).kind).toBe("busy");
  });

  it("takes over a lock file that is garbage (a crash while writing it)", async () => {
    const d = await device({ papers: [PAPER] });
    await writeLock(d, "{ half a json");
    expectSynced(await d.service.syncNow());
    expect(await pathExists(d.lib.paths.lockPath())).toBe(false);
  });

  it("works again once the other app releases the lock", async () => {
    const d = await device({ papers: [PAPER] });
    await writeLock(d, lockInfo());
    expect((await d.service.syncNow()).kind).toBe("busy");
    await fs.rm(d.lib.paths.lockPath());
    expectSynced(await d.service.syncNow());
    expect(d.service.status().state).toBe("idle");
    expect(d.service.status().holder).toBeUndefined();
  });

  it("releases the lock even when the run fails", async () => {
    const remote = new FakeRemoteProvider();
    const d = await device({ papers: [PAPER], remote });
    remote.failWith(new Error("Drive is down"));
    expect((await d.service.syncNow()).kind).toBe("failed");
    expect(await pathExists(d.lib.paths.lockPath())).toBe(false);
  });
});

describe("SyncService.syncNow: preconditions and failures", () => {
  it("skips with 'unconfigured' when there is no OAuth client, touching nothing", async () => {
    const remote = new FakeRemoteProvider();
    const d = await device({ papers: [PAPER], remote, client: undefined });
    const outcome = await d.service.syncNow();
    expect(outcome).toEqual({ kind: "skipped", reason: "no Google OAuth client configured" });
    expect(d.service.status().state).toBe("unconfigured");
    expect(await pathExists(d.lib.paths.lockPath())).toBe(false);
    expect(d.factory).not.toHaveBeenCalled();
  });

  it("skips with 'disconnected' when not signed in", async () => {
    const d = await device({ papers: [PAPER], tokens: new MemoryTokenStore() });
    const outcome = await d.service.syncNow();
    expect(outcome).toEqual({ kind: "skipped", reason: "not signed in to Google Drive" });
    expect(d.service.status().state).toBe("disconnected");
    expect(d.factory).not.toHaveBeenCalled();
    expect(await pathExists(d.lib.paths.syncDir() + "/google-drive.state.json")).toBe(false);
  });

  it("reports a provider error as failed, in the error state, and recovers on the next run", async () => {
    const remote = new FakeRemoteProvider();
    const d = await device({ papers: [PAPER], remote });
    remote.failWith(new Error("Drive is down"));

    const outcome = await d.service.syncNow();

    expect(outcome).toEqual({ kind: "failed", error: "Drive is down", reauth: false });
    expect(d.service.status()).toMatchObject({ state: "error", lastError: "Drive is down" });
    expect(d.logs.some((l) => l.level === "ERROR" && l.message === "Sync failed")).toBe(true);
    expect(await pathExists(d.lib.paths.lastRunPath())).toBe(false);

    remote.failWith(undefined);
    expectSynced(await d.service.syncNow());
    expect(d.service.status().state).toBe("idle");
    expect(d.service.status().lastError).toBeUndefined();
  });

  it("reports a disconnected provider as failed", async () => {
    const remote = new FakeRemoteProvider();
    remote.setConnected(false);
    const d = await device({ papers: [PAPER], remote });
    const outcome = await d.service.syncNow();
    expect(outcome).toMatchObject({ kind: "failed", error: "Sync provider is not connected", reauth: false });
  });

  it("asks for a new sign-in (state disconnected, reauth true) when the refresh token no longer works", async () => {
    const remote = new FakeRemoteProvider();
    const d = await device({ papers: [PAPER], remote });
    remote.failWith(new ReauthRequiredError());

    const outcome = await d.service.syncNow();

    expect(outcome).toMatchObject({ kind: "failed", reauth: true });
    expect(d.service.status().state).toBe("disconnected");
  });

  it("shares one run between concurrent calls", async () => {
    const remote = new FakeRemoteProvider();
    const d = await device({ papers: [PAPER], remote });

    const [first, second, third] = await Promise.all([d.service.syncNow("a"), d.service.syncNow("b"), d.service.syncNow("c")]);

    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(d.factory).toHaveBeenCalledTimes(1);
    expect(expectSynced(first).record.uploaded).toBe(4);

    expectSynced(await d.service.syncNow("later"));
    expect(d.factory).toHaveBeenCalledTimes(2);
  });

  it("stop() hands back the run in flight and nothing when idle", async () => {
    const d = await device({ papers: [PAPER] });
    expect(d.service.stop()).toBeUndefined();
    const running = d.service.syncNow();
    const pending = d.service.stop();
    expect(pending).toBe(running);
    expectSynced(await pending!);
  });
});

describe("SyncService.periodicTick", () => {
  async function writeLastRun(d: Device, app: string, ageMs: number): Promise<void> {
    const finished = new Date(Date.now() - ageMs).toISOString();
    const record: SyncRunRecord = {
      providerId: "google-drive", app, host: "elsewhere", startedAt: finished, finishedAt: finished,
      uploaded: 0, downloaded: 0, deletedLocal: 0, deletedRemote: 0, conflicts: [],
    };
    await fs.mkdir(d.lib.paths.syncDir(), { recursive: true });
    await fs.writeFile(d.lib.paths.lastRunPath(), JSON.stringify(record));
  }

  it("runs when nothing has ever synced", async () => {
    const d = await device({ papers: [PAPER] });
    const outcome = await d.service.periodicTick(10 * 60_000);
    expect(outcome?.kind).toBe("synced");
    expect(d.factory).toHaveBeenCalledTimes(1);
  });

  it("skips when this app synced less than half an interval ago", async () => {
    const d = await device({ papers: [PAPER] });
    await d.service.syncNow();
    d.factory.mockClear();
    expect(await d.service.periodicTick(10 * 60_000)).toBeUndefined();
    expect(d.factory).not.toHaveBeenCalled();
  });

  it("skips when another app synced recently, and runs once that is old enough", async () => {
    const d = await device({ papers: [PAPER] });
    await writeLastRun(d, "vscode", 60_000);
    expect(await d.service.periodicTick(10 * 60_000)).toBeUndefined();

    await writeLastRun(d, "vscode", 4 * 60_000);
    expect(await d.service.periodicTick(10 * 60_000)).toBeUndefined();

    await writeLastRun(d, "vscode", 6 * 60_000);
    const outcome = await d.service.periodicTick(10 * 60_000);
    expect(outcome?.kind).toBe("synced");
  });

  it("runs when the last sync is old", async () => {
    const d = await device({ papers: [PAPER] });
    await writeLastRun(d, "terminal", 3 * 3_600_000);
    expect((await d.service.periodicTick(10 * 60_000))?.kind).toBe("synced");
  });

  it("does nothing when not signed in or not configured", async () => {
    const out = await device({ papers: [PAPER], tokens: new MemoryTokenStore() });
    expect(await out.service.periodicTick(1000)).toBeUndefined();
    const none = await device({ papers: [PAPER], client: undefined });
    expect(await none.service.periodicTick(1000)).toBeUndefined();
    expect(out.factory).not.toHaveBeenCalled();
    expect(none.factory).not.toHaveBeenCalled();
  });
});

describe("SyncService timers", () => {
  const FAKE = { doNotFake: ["Date", "nextTick", "setImmediate", "queueMicrotask", "performance", "hrtime"] as Array<"Date" | "nextTick" | "setImmediate" | "queueMicrotask" | "performance" | "hrtime"> };

  it("notifyLocalChange schedules a sync 30 s later, and a burst of changes syncs once", async () => {
    const d = await device({ papers: [PAPER] });
    jest.useFakeTimers(FAKE);

    d.service.notifyLocalChange();
    jest.advanceTimersByTime(20_000);
    d.service.notifyLocalChange();
    jest.advanceTimersByTime(20_000);
    d.service.notifyLocalChange();
    jest.advanceTimersByTime(29_999);
    await new Promise((resolve) => setImmediate(resolve));
    expect(d.factory).not.toHaveBeenCalled();
    expect(d.statuses.some((s) => s.state === "syncing")).toBe(false);

    jest.advanceTimersByTime(1);
    const outcome = await d.service.syncNow("test");
    expect(outcome.kind).toBe("synced");
    expect(d.factory).toHaveBeenCalledTimes(1);
    expect(await pathExists(d.lib.paths.lastRunPath())).toBe(true);
  });

  it("notifyLocalChange does nothing unless the service is idle (signed in and configured)", async () => {
    const out = await device({ papers: [PAPER], tokens: new MemoryTokenStore() });
    const none = await device({ papers: [PAPER], client: undefined });
    jest.useFakeTimers(FAKE);
    out.service.notifyLocalChange();
    none.service.notifyLocalChange();
    jest.advanceTimersByTime(120_000);
    await new Promise((resolve) => setImmediate(resolve));
    expect(out.factory).not.toHaveBeenCalled();
    expect(none.factory).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  it("stop() cancels a scheduled sync", async () => {
    const d = await device({ papers: [PAPER] });
    jest.useFakeTimers(FAKE);
    d.service.notifyLocalChange();
    expect(jest.getTimerCount()).toBe(1);
    d.service.stop();
    expect(jest.getTimerCount()).toBe(0);
    jest.advanceTimersByTime(60_000);
    expect(d.factory).not.toHaveBeenCalled();
  });

  it("startPeriodic syncs on each interval until stopped; zero disables it", async () => {
    const d = await device({ papers: [PAPER] });
    jest.useFakeTimers(FAKE);

    d.service.startPeriodic(0);
    expect(jest.getTimerCount()).toBe(0);

    d.service.startPeriodic(5);
    expect(jest.getTimerCount()).toBe(1);
    jest.advanceTimersByTime(5 * 60_000);
    await until(() => d.factory.mock.calls.length === 1);
    await until(() => d.service.status().state === "idle");

    d.service.stop();
    expect(jest.getTimerCount()).toBe(0);
    jest.advanceTimersByTime(60 * 60_000);
    expect(d.factory).toHaveBeenCalledTimes(1);
  });
});

describe("SyncService.login / logout", () => {
  it("signs in through the loopback flow, then signs out and forgets the tokens", async () => {
    const tokens = new MemoryTokenStore();
    const calls: string[] = [];
    const authFetch = (async (input: string | URL | Request) => {
      calls.push(String(input));
      if (String(input).includes("/revoke")) { return new Response("", { status: 200 }); }
      return new Response(JSON.stringify({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600 }), { status: 200 });
    }) as typeof fetch;
    const d = await device({ tokens, authFetch });
    expect(d.service.status().state).toBe("disconnected");

    let browser: Promise<number> | undefined;
    await d.service.login({
      openBrowser: (url) => {
        const parsed = new URL(url);
        browser = httpGet(`${parsed.searchParams.get("redirect_uri")}/?code=abc&state=${parsed.searchParams.get("state")}`);
      },
    });
    expect(await browser).toBe(200);

    expect(d.service.status().state).toBe("idle");
    expect(tokens.tokens).toMatchObject({ access_token: "new-access", refresh_token: "new-refresh" });
    expect(d.logs.map((l) => l.message)).toContain("Signed in to Google Drive");

    await d.service.logout();
    expect(d.service.status().state).toBe("disconnected");
    expect(tokens.tokens).toBeNull();
    expect(calls.some((c) => c.startsWith("https://oauth2.googleapis.com/revoke?token=new-refresh"))).toBe(true);
    expect(d.logs.map((l) => l.message)).toContain("Signed out of Google Drive");

    expect((await d.service.syncNow()).kind).toBe("skipped");
  });
});
