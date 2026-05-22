/**
 * Thin HTTP wrapper around the Google Drive REST API v3 — token-agnostic,
 * receives a token callback from the caller.
 *
 * @depends none
 * @dependents googleDriveProvider
 */

const BASE = "https://www.googleapis.com";
const UPLOAD_BASE = "https://www.googleapis.com/upload";

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  size?: string;
  parents?: string[];
}

export interface DriveFileList {
  files: DriveFile[];
  nextPageToken?: string;
}

interface ListParams {
  q: string;
  spaces: string;
  fields: string;
  pageToken?: string;
}

// Throws a descriptive error when the HTTP response indicates a Drive API failure.
async function assertOk(res: Response): Promise<void> {
  if (res.status >= 400) {
    let body = "";
    try {
      body = await res.text();
    } catch {
      // ignore
    }
    throw new Error(`Drive API error ${res.status}: ${body.slice(0, 200)}`);
  }
}

/** Thin HTTP client for Google Drive REST API v3. @usedBy googleDriveProvider. */
export class DriveClient {
  constructor(private readonly getToken: () => Promise<string>) {}

  // Builds the Authorization header by calling the injected token provider.
  private async authHeader(): Promise<Record<string, string>> {
    const token = await this.getToken();
    return { Authorization: `Bearer ${token}` };
  }

  /** Lists Drive files matching the given query parameters. */
  async listFiles(params: ListParams): Promise<DriveFileList> {
    const auth = await this.authHeader();
    const url = new URL(`${BASE}/drive/v3/files`);
    url.searchParams.set("q", params.q);
    url.searchParams.set("spaces", params.spaces);
    url.searchParams.set("fields", params.fields);
    if (params.pageToken) {
      url.searchParams.set("pageToken", params.pageToken);
    }
    const res = await fetch(url.toString(), { headers: auth });
    await assertOk(res);
    return res.json() as Promise<DriveFileList>;
  }

  /** Creates a Drive folder with the given name under the specified parent ids. */
  async createFolder(name: string, parents: string[]): Promise<DriveFile> {
    const auth = await this.authHeader();
    const res = await fetch(`${BASE}/drive/v3/files`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        mimeType: "application/vnd.google-apps.folder",
        parents,
      }),
    });
    await assertOk(res);
    return res.json() as Promise<DriveFile>;
  }

  /** Uploads file content to Drive using multipart upload, updating an existing file if existingId is provided. */
  async uploadFile(
    name: string,
    parents: string[],
    content: Uint8Array,
    mimeType: string,
    existingId?: string,
  ): Promise<DriveFile> {
    const auth = await this.authHeader();
    const boundary = "labshelf_boundary_" + Date.now().toString(36);
    const meta = JSON.stringify(existingId ? { name } : { name, parents });
    const metaPart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n`;
    const dataPart = `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`;
    const closing = `\r\n--${boundary}--`;

    const encoder = new TextEncoder();
    const metaBytes = encoder.encode(metaPart);
    const dataHeaderBytes = encoder.encode(dataPart);
    const closingBytes = encoder.encode(closing);

    const body = new Uint8Array(
      metaBytes.length + dataHeaderBytes.length + content.length + closingBytes.length,
    );
    let offset = 0;
    body.set(metaBytes, offset); offset += metaBytes.length;
    body.set(dataHeaderBytes, offset); offset += dataHeaderBytes.length;
    body.set(content, offset); offset += content.length;
    body.set(closingBytes, offset);

    if (existingId) {
      const url = new URL(`${UPLOAD_BASE}/drive/v3/files/${existingId}`);
      url.searchParams.set("uploadType", "multipart");
      const res = await fetch(url.toString(), {
        method: "PATCH",
        headers: { ...auth, "Content-Type": `multipart/related; boundary=${boundary}` },
        body,
      });
      await assertOk(res);
      return res.json() as Promise<DriveFile>;
    }

    const url = new URL(`${UPLOAD_BASE}/drive/v3/files`);
    url.searchParams.set("uploadType", "multipart");
    const res = await fetch(url.toString(), {
      method: "POST",
      headers: { ...auth, "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
    });
    await assertOk(res);
    return res.json() as Promise<DriveFile>;
  }

  /** Downloads a Drive file by id and returns its raw bytes. */
  async downloadFile(fileId: string): Promise<Uint8Array> {
    const auth = await this.authHeader();
    const url = new URL(`${BASE}/drive/v3/files/${fileId}`);
    url.searchParams.set("alt", "media");
    const res = await fetch(url.toString(), { headers: auth });
    await assertOk(res);
    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
  }

  /** Permanently deletes a Drive file by id. */
  async deleteFile(fileId: string): Promise<void> {
    const auth = await this.authHeader();
    const res = await fetch(`${BASE}/drive/v3/files/${fileId}`, {
      method: "DELETE",
      headers: auth,
    });
    if (res.status !== 204 && res.status >= 400) {
      await assertOk(res);
    }
  }

  /** Moves a Drive file to a new parent and optionally renames it in a single PATCH request. */
  async moveFile(
    fileId: string,
    newParentId: string,
    oldParentId: string,
    newName?: string,
  ): Promise<DriveFile> {
    const auth = await this.authHeader();
    const url = new URL(`${BASE}/drive/v3/files/${fileId}`);
    url.searchParams.set("addParents", newParentId);
    url.searchParams.set("removeParents", oldParentId);
    url.searchParams.set("fields", "id,name,mimeType,modifiedTime,size,parents");
    const body: Record<string, string> = {};
    if (newName) {
      body["name"] = newName;
    }
    const res = await fetch(url.toString(), {
      method: "PATCH",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    await assertOk(res);
    return res.json() as Promise<DriveFile>;
  }

  /** Returns the list of parent folder ids for a Drive file. */
  async getFileParents(fileId: string): Promise<string[]> {
    const auth = await this.authHeader();
    const url = new URL(`${BASE}/drive/v3/files/${fileId}`);
    url.searchParams.set("fields", "parents");
    const res = await fetch(url.toString(), { headers: auth });
    await assertOk(res);
    const data = (await res.json()) as { parents?: string[] };
    return data.parents ?? [];
  }
}
