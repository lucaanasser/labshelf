/**
 * Implements RemoteProvider using an injected IAuthProvider and DriveClient,
 * mapping Drive API concepts to the provider-agnostic RemoteFile interface.
 *
 * @depends sync/provider/remoteProvider, sync/provider/authProvider, googleDriveClient
 * @dependents syncController (vscode), browserSyncController (browser)
 */
import type {
  RemoteProvider,
  RemoteFile,
  RemoteNamespace,
} from "../provider/remoteProvider.js";
import { SYNC_PROVIDER_ID } from "../../library/index.js";
import type { IAuthProvider } from "../provider/authProvider.js";
import type { DriveFile } from "./googleDriveClient.js";
import { DriveClient } from "./googleDriveClient.js";

const FOLDER_MIME = "application/vnd.google-apps.folder";
const LIST_FIELDS = "files(id,name,mimeType,modifiedTime,size)";
const APPDATA_ROOT_ID = "appDataFolder";

// Converts a raw DriveFile response to the provider-agnostic RemoteFile shape.
function toRemoteFile(f: DriveFile): RemoteFile {
  const file: RemoteFile = {
    id: f.id,
    name: f.name,
    isFolder: f.mimeType === FOLDER_MIME,
    modifiedTime: f.modifiedTime,
  };
  if (f.size !== undefined) {
    file.size = parseInt(f.size, 10);
  }
  return file;
}

/** Google Drive implementation of RemoteProvider. */
export class GoogleDriveProvider implements RemoteProvider {
  readonly id = SYNC_PROVIDER_ID;
  readonly displayName = "Google Drive";

  // Folders that live in the hidden appDataFolder space. Drive only returns their children when the
  // query names that space, so every folder discovered or created under the appdata root is recorded here.
  private readonly appdataFolderIds = new Set<string>([APPDATA_ROOT_ID]);

  constructor(
    private readonly auth: IAuthProvider,
    private readonly client: DriveClient,
  ) {}

  async connect(): Promise<void> {
    await this.auth.authenticate();
  }

  async disconnect(): Promise<void> {
    await this.auth.revoke();
  }

  isConnected(): boolean {
    return this.auth.isAuthenticated();
  }

  async resolveRoot(ns: RemoteNamespace): Promise<RemoteFile> {
    if (ns === "appdata") {
      return this.resolveAppdataRoot();
    }
    return this.resolveLibraryRoot();
  }

  // Finds or creates the top-level "LabShelf Library" folder in Drive.
  private async resolveLibraryRoot(): Promise<RemoteFile> {
    const result = await this.client.listFiles({
      q: "name='LabShelf Library' and mimeType='application/vnd.google-apps.folder' and trashed=false",
      spaces: "drive",
      fields: LIST_FIELDS,
    });
    if (result.files.length > 0) {
      return toRemoteFile(result.files[0]!);
    }
    const created = await this.client.createFolder("LabShelf Library", []);
    return toRemoteFile(created);
  }

  // Returns the synthetic RemoteFile for the Drive appDataFolder namespace.
  private async resolveAppdataRoot(): Promise<RemoteFile> {
    // appDataFolder is a Drive special alias — list to confirm access is granted.
    const result = await this.client.listFiles({
      q: "trashed=false",
      spaces: "appDataFolder",
      fields: LIST_FIELDS,
    });
    // The appDataFolder itself is virtual; return a synthetic RemoteFile for it.
    // Any child creation uses parents: ['appDataFolder'].
    void result; // we only need to confirm access
    return {
      id: APPDATA_ROOT_ID,
      name: APPDATA_ROOT_ID,
      isFolder: true,
      modifiedTime: new Date().toISOString(),
    };
  }

  /**
   * Lists the direct children of a folder in the Drive space that holds it.
   * The parent clause is required for the appdata root too: a bare "trashed=false" query over the
   * appDataFolder space returns files at every depth, which flattened "<paperId>/data.json" into
   * "data.json" and made the diff delete the per-paper sidecars locally.
   * @usedBy sync/core/treeScan (scanRemoteTree)
   * @returns the folder's direct children, every page concatenated.
   */
  async list(folderId: string): Promise<RemoteFile[]> {
    const inAppdata = this.appdataFolderIds.has(folderId);
    const q = `'${folderId}' in parents and trashed=false`;
    const spaces = inAppdata ? "appDataFolder" : "drive";

    const files: RemoteFile[] = [];
    let pageToken: string | undefined;

    do {
      const result = await this.client.listFiles({
        q,
        spaces,
        fields: `nextPageToken,${LIST_FIELDS}`,
        ...(pageToken !== undefined ? { pageToken } : {}),
      });
      files.push(...result.files.map(toRemoteFile));
      pageToken = result.nextPageToken;
    } while (pageToken);

    if (inAppdata) {
      for (const f of files) {
        if (f.isFolder) { this.appdataFolderIds.add(f.id); }
      }
    }
    return files;
  }

  async createFolder(parentId: string, name: string): Promise<RemoteFile> {
    const created = toRemoteFile(await this.client.createFolder(name, [parentId]));
    if (this.appdataFolderIds.has(parentId)) { this.appdataFolderIds.add(created.id); }
    return created;
  }

  async upload(
    parentId: string,
    name: string,
    content: Uint8Array,
    existingId?: string,
  ): Promise<RemoteFile> {
    const mimeType = "application/octet-stream";
    const result = await this.client.uploadFile(
      name,
      [parentId],
      content,
      mimeType,
      existingId,
    );
    return toRemoteFile(result);
  }

  async download(fileId: string): Promise<Uint8Array> {
    return this.client.downloadFile(fileId);
  }

  async remove(fileId: string): Promise<void> {
    return this.client.deleteFile(fileId);
  }

  async move(
    fileId: string,
    newParentId: string,
    newName?: string,
  ): Promise<RemoteFile> {
    const parents = await this.client.getFileParents(fileId);
    const oldParentId = parents[0] ?? "";
    const result = await this.client.moveFile(fileId, newParentId, oldParentId, newName);
    return toRemoteFile(result);
  }
}

/** Convenience factory that wires an IAuthProvider, a DriveClient, and a provider together. */
export function createGoogleDriveProvider(auth: IAuthProvider): GoogleDriveProvider {
  const client = new DriveClient(() => auth.getAccessToken());
  return new GoogleDriveProvider(auth, client);
}
