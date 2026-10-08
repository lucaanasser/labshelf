/**
 * Builds the publisher's own PDF URL from a DOI, for the platforms whose PDF
 * address is a fixed function of the DOI (Zotero's translators and Paperpile
 * rely on the same patterns). These are the links a subscriber clicks; they
 * download whenever the user's institution — by IP or by the session cookies
 * the fetcher sends — grants access, and otherwise fail harmlessly on a login
 * page, which the fetcher recognises as "not a PDF".
 * @depends capture/resolvers/types
 * @dependents capture/resolvers/resolverChain
 */
import type { PdfResolver, ResolveContext } from "./types";

type Template = (doi: string) => string;

// Atypon-hosted journals all serve /doi/pdf/<doi>.
const atypon = (host: string): Template => (doi) => `https://${host}/doi/pdf/${doi}`;

// DOI prefix → PDF URL. Only prefixes whose platform is unambiguous.
const BY_PREFIX: Record<string, Template[]> = {
  "10.1007": [(doi) => `https://link.springer.com/content/pdf/${doi}.pdf`],
  "10.1186": [(doi) => `https://link.springer.com/content/pdf/${doi}.pdf`],
  "10.1023": [(doi) => `https://link.springer.com/content/pdf/${doi}.pdf`],
  "10.1002": [(doi) => `https://onlinelibrary.wiley.com/doi/pdfdirect/${doi}`],
  "10.1111": [(doi) => `https://onlinelibrary.wiley.com/doi/pdfdirect/${doi}`],
  "10.1145": [atypon("dl.acm.org")],
  "10.1137": [atypon("epubs.siam.org")],
  "10.1080": [atypon("www.tandfonline.com")],
  "10.1177": [atypon("journals.sagepub.com")],
  "10.1073": [atypon("www.pnas.org")],
  "10.1126": [atypon("www.science.org")],
  "10.1021": [atypon("pubs.acs.org")],
  "10.1146": [atypon("www.annualreviews.org")],
  "10.1287": [atypon("pubsonline.informs.org")],
  "10.1056": [atypon("www.nejm.org")],
  "10.2514": [atypon("arc.aiaa.org")],
  "10.1061": [atypon("ascelibrary.org")],
  "10.1088": [(doi) => `https://iopscience.iop.org/article/${doi}/pdf`],
  "10.3389": [(doi) => `https://www.frontiersin.org/articles/${doi}/pdf`],
  "10.1371": [(doi) => `https://journals.plos.org/plosone/article/file?id=${doi}&type=printable`],
};

// Platforms whose PDF is keyed by their own article id, read off the landing URL.
const BY_LANDING_URL: Array<[RegExp, (m: RegExpExecArray) => string]> = [
  // ScienceDirect: the PII. "pdfft" answers with an interstitial the fetcher follows.
  [/sciencedirect\.com\/science\/article\/(?:abs\/)?pii\/([0-9A-Z]+)/i,
    (m) => `https://www.sciencedirect.com/science/article/pii/${m[1]}/pdfft?isDTMRedir=true&download=true`],
  // IEEE Xplore: the article number.
  [/ieeexplore\.ieee\.org\/(?:abstract\/)?document\/(\d+)/i,
    (m) => `https://ieeexplore.ieee.org/stampPDF/getPDF.jsp?tp=&arnumber=${m[1]}`],
];

/**
 * The publisher PDF URLs for a DOI, or [] when its platform is not known.
 * @usedBy publisherResolver, tests
 */
export function publisherPdfUrls(doi: string): string[] {
  const prefix = doi.slice(0, doi.indexOf("/"));
  return (BY_PREFIX[prefix] ?? []).map((t) => t(doi));
}

/**
 * The PDF URL for a landing page on a platform that keys PDFs by its own id.
 * @usedBy publisherResolver, tests
 */
export function landingPdfUrls(landingUrl: string): string[] {
  for (const [re, build] of BY_LANDING_URL) {
    const m = re.exec(landingUrl);
    if (m) return [build(m)];
  }
  return [];
}

export const publisherResolver: PdfResolver = {
  name: "publisher",
  async resolve(ctx: ResolveContext): Promise<string[]> {
    return [
      ...(ctx.landingUrl ? landingPdfUrls(ctx.landingUrl) : []),
      ...(ctx.doi ? publisherPdfUrls(ctx.doi) : []),
    ];
  },
};
