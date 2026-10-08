/**
 * GoogleDriveProvider listing semantics, against a fake Drive that answers queries the way the real
 * files.list does: a parent clause selects direct children, a bare "trashed=false" matches every file
 * of the space at any depth, and appDataFolder files are invisible to the "drive" space.
 */
import { GoogleDriveProvider, RemotePathResolver, scanRemoteTree } from "@labshelf/core";
import type { DriveClient, DriveFile, IAuthProvider } from "@labshelf/core";

const FOLDER = "application/vnd.google-apps.folder";

interface FakeItem extends DriveFile {
  space: "drive" | "appDataFolder";
  parent: string;
}

interface ListCall { q: string; spaces: string }

class FakeDrive {
  readonly calls: ListCall[] = [];
  private readonly items: FakeItem[] = [];
  private next = 1;

  add(space: FakeItem["space"], parent: string, name: string, opts: { folder?: boolean; modifiedTime?: string } = {}): string {
    const id = `id${this.next++}`;
    this.items.push({
      id,
      name,
      mimeType: opts.folder ? FOLDER : "application/octet-stream",
      modifiedTime: opts.modifiedTime ?? "2026-09-20T10:00:00.000Z",
      space,
      parent,
    });
    return id;
  }

  async listFiles(params: { q: string; spaces: string; fields: string; pageToken?: string }): Promise<{ files: DriveFile[] }> {
    this.calls.push({ q: params.q, spaces: params.spaces });
    const parent = /'([^']+)' in parents/.exec(params.q)?.[1];
    const files = this.items.filter((i) => i.space === params.spaces && (parent === undefined || i.parent === parent));
    return { files: files.map(({ id, name, mimeType, modifiedTime }) => ({ id, name, mimeType, modifiedTime })) };
  }

  async createFolder(name: string, parents: string[]): Promise<DriveFile> {
    const parent = parents[0] ?? "root";
    const inAppdata = parent === "appDataFolder" || this.items.some((i) => i.id === parent && i.space === "appDataFolder");
    const id = this.add(inAppdata ? "appDataFolder" : "drive", parent, name, { folder: true });
    return { id, name, mimeType: FOLDER, modifiedTime: "2026-09-20T10:00:00.000Z" };
  }
}

const auth: IAuthProvider = {
  isAuthenticated: () => true,
  getAccessToken: async () => "token",
  authenticate: async () => undefined,
  revoke: async () => undefined,
};

function provider(drive: FakeDrive): GoogleDriveProvider {
  return new GoogleDriveProvider(auth, drive as unknown as DriveClient);
}

/** Two papers' sidecars, laid out the way PaperDataStore uploads them: appDataFolder/<paperId>/data.json. */
function seedSidecars(drive: FakeDrive): void {
  const a = drive.add("appDataFolder", "appDataFolder", "paper-a", { folder: true });
  drive.add("appDataFolder", a, "data.json");
  const b = drive.add("appDataFolder", "appDataFolder", "paper-b", { folder: true });
  drive.add("appDataFolder", b, "data.json");
}

describe("GoogleDriveProvider.list", () => {
  it("lists only the direct children of the appdata root", async () => {
    const drive = new FakeDrive();
    seedSidecars(drive);
    const children = await provider(drive).list("appDataFolder");
    expect(children.map((c) => c.name).sort()).toEqual(["paper-a", "paper-b"]);
    expect(drive.calls[0]).toEqual({ q: "'appDataFolder' in parents and trashed=false", spaces: "appDataFolder" });
  });

  it("lists a folder found under the appdata root in the appDataFolder space", async () => {
    const drive = new FakeDrive();
    seedSidecars(drive);
    const p = provider(drive);
    const [folder] = (await p.list("appDataFolder")).filter((c) => c.name === "paper-a");
    const children = await p.list(folder!.id);
    expect(children.map((c) => c.name)).toEqual(["data.json"]);
    expect(drive.calls[1]).toEqual({ q: `'${folder!.id}' in parents and trashed=false`, spaces: "appDataFolder" });
  });

  it("keeps listing library folders in the drive space", async () => {
    const drive = new FakeDrive();
    const lib = drive.add("drive", "root", "LabShelf Library", { folder: true });
    drive.add("drive", lib, "papers", { folder: true });
    const children = await provider(drive).list(lib);
    expect(children.map((c) => c.name)).toEqual(["papers"]);
    expect(drive.calls[0]?.spaces).toBe("drive");
  });

  it("lists a folder it created under the appdata root in the appDataFolder space", async () => {
    const drive = new FakeDrive();
    const p = provider(drive);
    const created = await p.createFolder("appDataFolder", "paper-c");
    await p.list(created.id);
    expect(drive.calls[0]?.spaces).toBe("appDataFolder");
  });
});

describe("scanRemoteTree over the appdata namespace", () => {
  it("keeps per-paper sidecar paths instead of flattening them to data.json", async () => {
    const drive = new FakeDrive();
    seedSidecars(drive);
    const p = provider(drive);
    const tree = await scanRemoteTree(p, "appDataFolder", new RemotePathResolver(p, "appDataFolder"));
    expect([...tree.keys()].sort()).toEqual(["paper-a/data.json", "paper-b/data.json"]);
  });

  it("prefers the newest of two same-named files in one folder", async () => {
    const drive = new FakeDrive();
    const a = drive.add("appDataFolder", "appDataFolder", "paper-a", { folder: true });
    drive.add("appDataFolder", a, "data.json", { modifiedTime: "2026-09-21T10:00:00.000Z" });
    const newest = drive.add("appDataFolder", a, "data.json", { modifiedTime: "2026-09-22T10:00:00.000Z" });
    drive.add("appDataFolder", a, "data.json", { modifiedTime: "2026-09-20T10:00:00.000Z" });
    const p = provider(drive);
    const tree = await scanRemoteTree(p, "appDataFolder", new RemotePathResolver(p, "appDataFolder"));
    expect(tree.get("paper-a/data.json")?.remoteId).toBe(newest);
  });
});
