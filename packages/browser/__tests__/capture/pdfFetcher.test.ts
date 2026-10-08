import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fetchPdf, isBotCheck, nextHopsFromHtml } from "../../src/capture/pdfFetcher";
import { isPdfBytes } from "../../src/capture/pdfBytes";

const fixture = (name: string): string => readFileSync(join(__dirname, "..", "fixtures", name), "utf8");
const PDF = new TextEncoder().encode("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF");
const html = (body: string): Response => new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
const pdf = (): Response => new Response(PDF, { status: 200, headers: { "content-type": "application/octet-stream" } });

let routes: Record<string, () => Response>;
const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
  const url = String(input);
  const route = routes[url];
  return route ? route() : new Response("not found", { status: 404 });
});

beforeEach(() => {
  routes = {};
  fetchMock.mockClear();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

describe("isPdfBytes", () => {
  it("accepts a PDF header anywhere in the first KiB and rejects HTML", () => {
    expect(isPdfBytes(PDF)).toBe(true);
    expect(isPdfBytes(new TextEncoder().encode("\n\n%PDF-1.4"))).toBe(true);
    expect(isPdfBytes(new TextEncoder().encode("<!DOCTYPE html><title>Login</title>"))).toBe(false);
  });
});

describe("nextHopsFromHtml", () => {
  it("follows an interstitial's redirect to the real file", () => {
    const hops = nextHopsFromHtml(fixture("sciencedirectInterstitial.html"), "https://www.sciencedirect.com/science/article/pii/X/pdfft");
    expect(hops[0]).toBe("https://pdf.sciencedirectassets.com/272/1-s2.0-0196677482900074/main.pdf?X-Amz-Token=abc&X-Amz-Date=20261007");
  });

  it("finds nothing worth following on a login wall", () => {
    expect(nextHopsFromHtml(fixture("loginWall.html"), "https://publisher.example/login")).toEqual([]);
  });
});

describe("fetchPdf", () => {
  it("returns a PDF served directly, whatever its content-type says", async () => {
    routes["https://a.example/p.pdf"] = pdf;
    const got = await fetchPdf("https://a.example/p.pdf");
    expect(got?.url).toBe("https://a.example/p.pdf");
    expect(isPdfBytes(got!.bytes)).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith("https://a.example/p.pdf", expect.objectContaining({ credentials: "include" }));
  });

  it("walks through an interstitial page to the file", async () => {
    const target = "https://pdf.sciencedirectassets.com/272/1-s2.0-0196677482900074/main.pdf?X-Amz-Token=abc&X-Amz-Date=20261007";
    routes["https://www.sciencedirect.com/pdfft"] = () => html(fixture("sciencedirectInterstitial.html"));
    routes[target] = pdf;
    expect((await fetchPdf("https://www.sciencedirect.com/pdfft"))?.url).toBe(target);
  });

  it("gives up on a login wall without following its unrelated links", async () => {
    routes["https://publisher.example/doi/pdf/10.1/x"] = () => html(fixture("loginWall.html"));
    expect(await fetchPdf("https://publisher.example/doi/pdf/10.1/x")).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("survives network errors", async () => {
    fetchMock.mockImplementationOnce(async () => { throw new TypeError("Failed to fetch"); });
    expect(await fetchPdf("https://down.example/p.pdf")).toBeUndefined();
  });
});

describe("bot checks", () => {
  const challenge = "<!DOCTYPE html><html><head><title>Just a moment...</title></head><body>cf_chl_opt</body></html>";

  it("recognises a Cloudflare challenge, not an ordinary error page", () => {
    expect(isBotCheck(403, challenge)).toBe(true);
    expect(isBotCheck(404, challenge)).toBe(false);
    expect(isBotCheck(403, "<title>Forbidden</title>")).toBe(false);
  });

  it("sees a block message placed after a huge inline stylesheet", () => {
    const page = `<html><head><style>${"x".repeat(900_000)}</style></head><body>There was a problem providing the content you requested ::CLOUDFLARE_ERROR_1000S_BOX::</body></html>`;
    expect(isBotCheck(403, page)).toBe(true);
  });

  it("reports a challenged URL as blocked instead of following its links", async () => {
    routes["https://dl.acm.org/doi/pdf/10.1145/1"] = () => new Response(challenge, { status: 403, headers: { "content-type": "text/html" } });
    const blocked: string[] = [];
    expect(await fetchPdf("https://dl.acm.org/doi/pdf/10.1145/1", { blocked })).toBeUndefined();
    expect(blocked).toEqual(["https://dl.acm.org/doi/pdf/10.1145/1"]);
  });
});
