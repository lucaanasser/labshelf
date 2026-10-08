import { readFileSync } from "node:fs";
import { join } from "node:path";
import { READER_SHELL_BODY } from "@labshelf/reader";

jest.mock("webextension-polyfill", () => ({ runtime: { getURL: (p: string) => `chrome-extension://ext/${p}` } }));

import { createIdbSidecarPort, sidecarPath } from "../../src/reader/idbSidecarPort";
import { createInPageChannel } from "../../src/reader/inPageTransport";
import { parseReaderQuery, readerUrl } from "../../src/reader/readerTabs";

describe("reader page shell", () => {
  it("embeds exactly the shared skeleton the VS Code shell uses", () => {
    const html = readFileSync(join(__dirname, "../../src/reader/index.html"), "utf8");
    const body = html.slice(html.indexOf("<body>") + "<body>".length, html.indexOf("<script type=\"module\"")).trim();
    expect(body).toBe(READER_SHELL_BODY);
  });

  it("does not load base.css, whose box-sizing reset misaligns the pdf.js text layer", () => {
    const html = readFileSync(join(__dirname, "../../src/reader/index.html"), "utf8");
    expect(html).not.toContain("base.css");
    expect(html.indexOf("pdf_viewer.css")).toBeLessThan(html.indexOf("reader.css"));
  });
});

describe("idbSidecarPort", () => {
  it("keeps the sidecar at the appdata path VS Code syncs to .research/papers/<id>/data.json", async () => {
    expect(sidecarPath("abc")).toBe("appdata/abc/data.json");
    const files = new Map<string, Uint8Array>();
    const port = createIdbSidecarPort({
      stat: async (p: string) => (files.has(p) ? { isFile: true, isDirectory: false, mtimeMs: 0, size: 0 } : undefined),
      readFile: async (p: string) => files.get(p)!,
      writeFile: async (p: string, b: Uint8Array) => { files.set(p, b); },
    });
    expect(await port.read("abc")).toBeNull();
    await port.write("abc", "{\"theme\":\"dark\"}");
    expect([...files.keys()]).toEqual(["appdata/abc/data.json"]);
    expect(await port.read("abc")).toBe("{\"theme\":\"dark\"}");
  });
});

describe("readerTabs", () => {
  it("builds and parses reader URLs", () => {
    expect(readerUrl("10.1/x y")).toBe("chrome-extension://ext/reader/index.html?paper=10.1%2Fx+y");
    expect(readerUrl("p", 4)).toBe("chrome-extension://ext/reader/index.html?paper=p&page=4");
    expect(readerUrl("p", 0)).toBe("chrome-extension://ext/reader/index.html?paper=p");
    expect(parseReaderQuery("?paper=10.1%2Fx+y&page=3")).toEqual({ paperId: "10.1/x y", page: 3 });
    expect(parseReaderQuery("?paper=p&page=abc")).toEqual({ paperId: "p" });
    expect(parseReaderQuery("")).toEqual({ paperId: null });
  });
});

describe("in-page channel", () => {
  it("delivers asynchronously, clones payloads and buffers host messages until the reader listens", async () => {
    const received: unknown[] = [];
    const channel = createInPageChannel((m) => received.push(m));
    const toReader: unknown[] = [];
    channel.send({ type: "scrollToPage", pageNumber: 2 });
    const msg = { command: "pageChanged" as const, pageNumber: 1 };
    channel.transport.post(msg);
    expect(received).toHaveLength(0);
    channel.transport.listen((m) => toReader.push(m));
    await new Promise((r) => setTimeout(r, 5));
    expect(received).toEqual([msg]);
    expect(received[0]).not.toBe(msg);
    expect(toReader).toEqual([{ type: "scrollToPage", pageNumber: 2 }]);
  });
});
