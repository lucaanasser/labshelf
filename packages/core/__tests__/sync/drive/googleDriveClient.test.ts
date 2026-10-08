/**
 * Unit tests for DriveClient -- fetch is mocked so no real HTTP occurs.
 */

import { DriveClient } from "@labshelf/core";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockFetch(
  status: number,
  body: unknown,
): jest.SpyInstance {
  const res = {
    status,
    ok: status < 400,
    json: async () => body,
    text: async () => JSON.stringify(body),
    arrayBuffer: async () => new ArrayBuffer(0),
  } as unknown as Response;
  return jest.spyOn(global, "fetch").mockResolvedValue(res);
}

const TOKEN = "test-token-abc";
async function getToken(): Promise<string> {
  return TOKEN;
}

// ---------------------------------------------------------------------------
// listFiles
// ---------------------------------------------------------------------------

describe("DriveClient.listFiles", () => {
  afterEach(() => jest.restoreAllMocks());

  it("builds the correct URL and passes Authorization header", async () => {
    const spy = mockFetch(200, { files: [] });
    const client = new DriveClient(getToken);

    await client.listFiles({
      q: "name='foo' and trashed=false",
      spaces: "drive",
      fields: "files(id,name)",
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/drive/v3/files");
    expect(url).toContain("q=");
    expect(url).toContain("trashed");
    expect(url).toContain("spaces=drive");
    const headers = init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe(`Bearer ${TOKEN}`);
  });

  it("returns the files array from the response", async () => {
    const file = { id: "1", name: "foo.pdf", mimeType: "application/pdf", modifiedTime: "2026-01-01T00:00:00Z" };
    mockFetch(200, { files: [file] });
    const client = new DriveClient(getToken);

    const result = await client.listFiles({ q: "", spaces: "drive", fields: "" });
    expect(result.files).toHaveLength(1);
    expect(result.files[0]!.id).toBe("1");
  });

  it("throws when the API returns >= 400", async () => {
    mockFetch(403, { error: { message: "Forbidden" } });
    const client = new DriveClient(getToken);

    await expect(
      client.listFiles({ q: "", spaces: "drive", fields: "" }),
    ).rejects.toThrow("403");
  });
});

// ---------------------------------------------------------------------------
// uploadFile (multipart body)
// ---------------------------------------------------------------------------

describe("DriveClient.uploadFile", () => {
  afterEach(() => jest.restoreAllMocks());

  it("posts to multipart upload endpoint with correct content-type", async () => {
    const returned = { id: "newId", name: "test.bin", mimeType: "application/octet-stream", modifiedTime: "2026-01-01T00:00:00Z" };
    const spy = mockFetch(200, returned);
    const client = new DriveClient(getToken);
    const content = new Uint8Array([1, 2, 3]);

    await client.uploadFile("test.bin", ["parentId"], content, "application/octet-stream");

    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/upload/drive/v3/files");
    expect(url).toContain("uploadType=multipart");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toContain("multipart/related");
    expect(headers["Content-Type"]).toContain("boundary=");
  });

  it("uses PATCH when existingId is provided", async () => {
    const returned = { id: "existingId", name: "test.bin", mimeType: "application/octet-stream", modifiedTime: "2026-01-01T00:00:00Z" };
    const spy = mockFetch(200, returned);
    const client = new DriveClient(getToken);

    await client.uploadFile("test.bin", [], new Uint8Array([9]), "application/octet-stream", "existingId");

    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("existingId");
    expect(init.method).toBe("PATCH");
  });

  it("includes binary content in the multipart body", async () => {
    const returned = { id: "x", name: "f", mimeType: "application/octet-stream", modifiedTime: "" };
    const spy = mockFetch(200, returned);
    const client = new DriveClient(getToken);
    const content = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);

    await client.uploadFile("f", [], content, "application/octet-stream");

    const [, init] = spy.mock.calls[0] as [string, RequestInit];
    const body = init.body as Uint8Array;
    // Body must contain the raw bytes somewhere
    let found = false;
    for (let i = 0; i <= body.length - 4; i++) {
      if (body[i] === 0xde && body[i + 1] === 0xad && body[i + 2] === 0xbe && body[i + 3] === 0xef) {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// deleteFile
// ---------------------------------------------------------------------------

describe("DriveClient.deleteFile", () => {
  afterEach(() => jest.restoreAllMocks());

  it("sends DELETE and does not throw on 204", async () => {
    const spy = jest.spyOn(global, "fetch").mockResolvedValue({
      status: 204,
      ok: true,
      json: async () => ({}),
      text: async () => "",
    } as unknown as Response);
    const client = new DriveClient(getToken);

    await expect(client.deleteFile("abc123")).resolves.toBeUndefined();
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("abc123");
    expect(init.method).toBe("DELETE");
  });

  it("throws on 404", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue({
      status: 404,
      ok: false,
      json: async () => ({}),
      text: async () => "Not Found",
    } as unknown as Response);
    const client = new DriveClient(getToken);

    await expect(client.deleteFile("missing")).rejects.toThrow("404");
  });
});
