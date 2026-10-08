import { resolvePdf } from "../../src/capture/resolvers/resolverChain";
import type { PdfAttempt } from "../../src/capture/resolvers/resolverChain";
import type { ResolveContext } from "../../src/capture/resolvers/types";

const PDF = new TextEncoder().encode("%PDF-1.5 body");
let routes: Record<string, () => Response>;
const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
  const url = String(input);
  return routes[url]?.() ?? new Response("nope", { status: 404 });
});

beforeEach(() => {
  routes = {};
  fetchMock.mockClear();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

const ctx = (over: Partial<ResolveContext> = {}): ResolveContext => ({
  pageCandidates: [], allowSciHub: false, contactEmail: "me@uni.edu", sciHubMirror: "https://mirror.example", ...over,
});

describe("resolvePdf", () => {
  it("prefers the page's own link and labels it with whoever offered it", async () => {
    routes["https://scholar-pdf.example/p.pdf"] = () => new Response(PDF);
    const got = await resolvePdf(ctx({ pageCandidates: [{ url: "https://scholar-pdf.example/p.pdf", source: "scholar" }], doi: "10.1145/1.2" }));
    expect(got?.source).toBe("scholar");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls through a login wall to the publisher URL built from the DOI", async () => {
    routes["https://site.example/paper.pdf"] = () => new Response("<html><title>Sign in</title></html>", { headers: { "content-type": "text/html" } });
    routes["https://epubs.siam.org/doi/pdf/10.1137/S0895479802410815"] = () => new Response(PDF);
    const attempts: PdfAttempt[] = [];
    const got = await resolvePdf(ctx({
      doi: "10.1137/S0895479802410815",
      pageCandidates: [{ url: "https://site.example/paper.pdf", source: "page" }],
    }), {}, attempts);
    expect(got?.source).toBe("publisher");
    expect(attempts.map((a) => a.source)).toEqual(["page", "publisher"]);
  });

  it("asks Unpaywall with the contact email and uses its open-access copy", async () => {
    routes["https://api.crossref.org/works/10.9999%2Foa"] = () => new Response(JSON.stringify({ message: { link: [] } }));
    routes["https://api.unpaywall.org/v2/10.9999%2Foa?email=me%40uni.edu"] = () =>
      new Response(JSON.stringify({ best_oa_location: { url_for_pdf: "https://repo.example/oa.pdf" } }));
    routes["https://repo.example/oa.pdf"] = () => new Response(PDF);
    expect((await resolvePdf(ctx({ doi: "10.9999/oa" })))?.source).toBe("unpaywall");
  });

  it("never contacts the Sci-Hub mirror unless the user opted in", async () => {
    await resolvePdf(ctx({ doi: "10.9999/closed" }));
    expect(fetchMock.mock.calls.map((c) => String(c[0])).some((u) => u.startsWith("https://mirror.example"))).toBe(false);
  });

  it("retries a bot-checked candidate through a real tab, once, after everything else failed", async () => {
    routes["https://dl.acm.org/doi/pdf/10.1145/1.2"] = () =>
      new Response("<title>Just a moment...</title>", { status: 403, headers: { "content-type": "text/html" } });
    const viaHelperTab = jest.fn(async (urls: string[]) => ({ bytes: PDF, url: urls[0]! }));
    const attempts: PdfAttempt[] = [];
    const got = await resolvePdf(ctx({ pageCandidates: [{ url: "https://dl.acm.org/doi/pdf/10.1145/1.2", source: "scholar" }] }), { viaHelperTab }, attempts);
    expect(got?.source).toBe("scholar");
    expect(viaHelperTab).toHaveBeenCalledTimes(1);
    expect(viaHelperTab).toHaveBeenCalledWith(["https://dl.acm.org/doi/pdf/10.1145/1.2"]);
    expect(attempts.at(-1)).toEqual({ source: "scholar (via tab)", url: "https://dl.acm.org/doi/pdf/10.1145/1.2" });
  });

  it("returns undefined when nothing downloads as a PDF", async () => {
    expect(await resolvePdf(ctx({ arxivId: "2301.00001" }))).toBeUndefined();
  });
});
