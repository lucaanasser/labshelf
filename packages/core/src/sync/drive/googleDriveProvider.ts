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
import type { IAuthProvider } from "../provider/authProvider.js";
import type { DriveFile } from "./googleDriveClient.js";
import { DriveClient } from "./googleDriveClient.js";

const FOLDER_MIME = "application/vnd.google-apps.folder";
const LIST_FIELDS = "files(id,name,mimeType,modifiedTime,size)";

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
  readonly id = "google-drive";
  readonly displayName = "Google Drive";

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
      id: "appDataFolder",
      name: "appDataFolder",
      isFolder: true,
      modifiedTime: new Date().toISOString(),
    };
  }

  async list(folderId: string): Promise<RemoteFile[]> {
    const isAppData = folderId === "appDataFolder";
    const q = isAppData
      ? "trashed=false"
      : `'${folderId}' in parents and trashed=false`;
    const spaces = isAppData ? "appDataFolder" : "drive";

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

    return files;
  }

  async createFolder(parentId: string, name: string): Promise<RemoteFile> {
    const created = await this.client.createFolder(name, [parentId]);
    return toRemoteFile(created);
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
