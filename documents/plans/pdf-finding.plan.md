# Plan: Find PDFs as Well as Paperpile

Date: 2026-10-08. Branch `feat/reader-ux`. Scope: the browser extension (`packages/browser`).

## TL;DR

- **Measured.** On 66 real papers, counting only PDFs whose text matches the paper:
  - The current chain finds 21/66 from identifiers alone and 24/66 from the article page.
  - Four open-access resolvers, written but not wired in, raise this to **27/66** and **29/66**.
  - Without a browser session the ceiling is about 33/66.
- **Most of the remaining gap is closed-access papers the user can already read.** The access comes through their institution (IP, single sign-on such as CAFe/Shibboleth, EZproxy, OpenAthens) or a personal subscription. Paperpile wins there by downloading through the user's own access and retrying through the library proxy. Section 4 says how LabShelf can do the same.
- **For readers with no access at all**, section 5 adds a legal last step that Paperpile lacks: one click asks the paper's author for a copy by email.
- **Where the code goes:** the resolver chain moves to core during [architecture-refactor.plan.md](architecture-refactor.plan.md) step 6.3, so VS Code and the terminal get the same PDF search. Implement the steps below there.

---

## 1. Where things stand

### 1.1 Written but not wired in

These files compile, but nothing calls them and they have no tests:

- `capture/resolvers/openalexResolver.ts`: OpenAlex by DOI (free endpoint). Reads the PDF and landing locations and the PMCID. Landing copies are checked with `sameWork`.
- `capture/resolvers/semanticScholarResolver.ts`: one call per capture. Reads `openAccessPdf` and turns `externalIds` (ArXiv, ACL, PubMedCentral) into arXiv, ACL Anthology or PMC candidates.
- `capture/resolvers/europePmcResolver.ts`: REST search, used for identifiers only. Requires a title match.
- `capture/resolvers/pmcResolver.ts`: PMCID to PDF, first the AWS open-data bucket, then the PMC site. It also contains `solvePmcPow()` for PMC's proof-of-work page (see 2.1).
- `capture/titleMatch.ts`: `sameWork()`. Accepts a title equal after normalisation or with word-bigram Dice ≥ 0.9, a year within ±1 (±2 for preprints), and a shared surname.
- `capture/resolvers/types.ts`: `ResolveContext` gains `pmcid`, `title`, `authors` and `year`.

### 1.2 Measurement

The method:

- **Corpus:** 66 real papers in 10 categories (CS/ML, biomedical, physics/maths, chemistry/engineering, Brazilian/SciELO, social science, preprints, pre-1990, book chapters, and paywalled papers with a free copy).
- **Runner:** Node, Chrome User-Agent, no browser cookies, no helper tab.
- **Counting:** a PDF counts only if `pdftotext` finds at least 60% of the title's words on pages 1–2.
- **Scenarios:** "ids" knows only the DOI, arXiv id or PMID (like a Google Scholar result). "landing" also reads the article page (like the toolbar popup).

| | Current chain | Current chain + 4 resolvers (sequential) |
|---|---|---|
| ids: correct PDF | 21/66 (31.8%) | **27/66 (40.9%)** |
| landing: correct PDF | 24/66 (36.4%) | **29/66 (43.9%)** |
| Any PDF, ids / landing | 23 / 27 | 30 / 31 |
| Median time to "not found" | 0.3 s | 4.9 s |
| Median time to a PDF | 1.3–1.7 s | 1.5–2.0 s |

Gains by category:

- **Biomedical:** 1 → 3, through PubMed Central.
- **CS/ML:** 2 → 4 (ids) and 6 → 7 (landing), from arXiv and ACL twins found through Semantic Scholar.
- **Paywalled papers with a free copy:** 3 → 5 with the right PDF. Before, two of the PDFs found were the wrong document.

Two caveats:

- OpenAlex supplied most of the hits, but it ran first in the test chain, so it also took credit for papers that later resolvers would have found.
- With the four resolvers, "not found" takes longer because they run one after another. Section 3 step 2 fixes this.

The ceiling:

- 33/66 corpus papers have a free PDF that `curl` can download at all.
- The rest is closed access or behind bot checks that only a real browser passes.
- That remainder is the subject of section 4.

---

## 2. What we know (live research, 2026-10-07)

### 2.1 Open-access sources

| Source | Use | Facts that matter |
|---|---|---|
| OpenAlex | `GET /works/doi:<doi>?mailto=<email>` | Lookups by DOI and PMID and `autocomplete` are free. `search=` and `filter=title.search:` cost 10 credits, against a budget of about 1,000 credits per IP per day, and core's `openAlexSearch` uses them. Read `best_oa_location`, `locations[].pdf_url`, `landing_page_url` and `ids.pmcid`. |
| Semantic Scholar | `GET /graph/v1/paper/DOI:<doi>?fields=openAccessPdf,externalIds,title,year,authors` | About 55% of keyless calls get a 429 with no Retry-After. Use 1 call per capture, no retry, and treat 404 or 429 as "unknown". `externalIds` is the best way to find arXiv and ACL twins. |
| Europe PMC | REST `search?query=DOI:"…"&resultType=core&format=json` | Use it for identifiers only: its PDF pages are behind Cloudflare. It has mapped the XGBoost DOI to an unrelated paper, so require a title match. |
| PubMed Central | ID converter `pmc.ncbi.nlm.nih.gov/tools/idconv/api/v1/articles/?ids=…`, E-utilities `esummary` (`articleids` → `pmc`) | NCBI allows 3 requests/s and answers 429 above that, so queue NCBI calls globally. Legacy `www.ncbi.nlm.nih.gov/pmc/articles/…` URLs now redirect to a 404, so never emit them. |
| PMC PDF | 1) AWS open-data bucket `pmc-oa-opendata` (no challenge). 2) `pmc.ncbi.nlm.nih.gov/articles/PMC<n>/pdf/` | The site answers 200 "Preparing to download" with `POW_CHALLENGE` and `POW_DIFFICULTY=4`. Find a nonce so that `sha256(challenge + nonce)` starts with `0000`; that takes about 65k hashes. Then send cookie `cloudpmc-viewer-pow = challenge + "," + nonce`. One cookie served 5 articles. Together with the bucket, this recovered 24 of 25 failed open-access papers. A service worker cannot set `Cookie` on `fetch`, so it needs the `cookies` permission, or the request has to run inside the helper tab. |
| CrossRef | `/works/<doi>?mailto=` | `link[]` holds publisher PDFs, sometimes typed `unspecified`. `relation.has-preprint` points to preprints; drop targets with the same DOI prefix. |
| Unpaywall | `/v2/<doi>?email=` | Returns the same open locations as OpenAlex, so it is only a fallback. When `url_for_pdf` is null, still follow `url_for_landing_page`. For example, HAL holds the full text of `10.1038/nature14539`, but Unpaywall lists only its landing page. |
| arXiv API | `export.arxiv.org/api/query?search_query=ti:"…"+AND+au:<surname>` | Precise. The undocumented `doi:` search works. Old-style ids such as `hep-th/9711200` download fine, but LabShelf's regexes miss them. Answers can take 15–46 s under load, so use an 8 s timeout. |
| bioRxiv / medRxiv | `api.biorxiv.org/details/<server>/<doi>` | 28% of calls return 500; retry once. Every PDF is behind Cloudflare, so use the helper tab. New preprints use the DOI prefix `10.64898`. |
| HAL, Zenodo, DOAJ, ACL Anthology | HAL `q=doiId_s:"<doi>"&fl=fileMain_s`; Zenodo `api/records/<id>`; ACL `aclanthology.org/<id>.pdf` | ACL ids are case-sensitive (`N19-1423`). |

Not worth it:

- DBLP's API (blocked by an Anubis bot check, even for curl).
- CORE (needs a key).
- DataCite `contentUrl` (almost never filled).
- Semantic Scholar title search without a key (rate-limited and often wrong).

### 2.2 Most PDF links are behind bot walls

- In a random open-access sample, only 40 of 88 of Unpaywall's best PDF links downloaded.
- In a random CrossRef sample, only 3 of 19 did.

Today `isBotCheck` looks only at status 403/429/503/202 plus a Cloudflare/Akamai regex. These walls slip through it, so they are never retried in the helper tab:

| Wall | Status | Signature |
|---|---|---|
| F5 / Fastly "Client Challenge" (Springer, eLife, JSTOR) | 200 or 406 | `<title>Client Challenge</title>`, `/_fs-ch-` |
| AWS WAF (IEEE, De Gruyter, figshare) | 202 | empty body, header `x-amzn-waf-action: challenge`, `token.awswaf.com` |
| Anubis (HAL, DBLP) | 200 | `anubis_challenge`, "Making sure you're not a bot" |
| PMC proof-of-work | 200 | `POW_CHALLENGE`, `cloudpmc-viewer-pow` (solve it instead, see 2.1) |
| Radware (IOP) | 200 after a redirect | final host `validate.perfdrive.com` |
| Imperva / Incapsula (Project Euclid, SPIE) | 200 | `_Incapsula_Resource`, header `x-iinfo` |
| HighWire legacy JavaScript | 200 | `function leastFactor(` |

Match these on **any** status and on the final URL as well as the body.

### 2.3 The APIs sometimes point to the wrong paper

Observed cases:

- **ResNet (`10.1109/CVPR.2016.90`):** OpenAlex, Unpaywall and Semantic Scholar give a Colombian thesis as its best open copy.
- **BWA:** OpenAlex attaches BWA-SW's PMC copy to BWA.
- **XGBoost:** Europe PMC maps the DOI to an unrelated paper.
- **Semantic Scholar title match:** returns the wrong BWA paper with a high score.

The rule:

- Before accepting a copy that an aggregator found, compare titles with `sameWork`. This is cheap: the metadata title first, then the landing page's `citation_title`.
- Checking the PDF's first page would be the strongest test, but text extraction in the service worker is not available yet.

### 2.4 Publisher PDF URLs

Downloaded as real PDF bytes from this machine (no browser):

- **Springer:** `link.springer.com/content/pdf/<doi>.pdf` (prefixes 10.1007, 10.1186, 10.1023).
- **Nature:** `nature.com/articles/<id>.pdf`.
- **IEEE:** `stampPDF/getPDF.jsp?arnumber=<n>`.
- **Frontiers:** `frontiersin.org/articles/<doi>/pdf`.
- **PLOS:** `journals.plos.org/plosone/article/file?id=<doi>&type=printable`, which works for every PLOS journal code.
- **MDPI:** the CDN `mdpi-res.com/d_attachment/<slug>/<slug>-<vol>-<art>/article_deploy/<slug>-<vol>-<art>.pdf` (the main site is behind Akamai).
- **eLife:** `api.elifesciences.org/articles/<id>` → `.pdf` on its CDN (the version number matters).
- **MIT Press:** `mitpressjournals.org/doi/pdf/<doi>` (redirects to a signed PDF).

Shape known, but behind Cloudflare or a login from here (these download for a subscriber's browser):

- **Wiley:** `/doi/pdfdirect/<doi>`.
- **ScienceDirect:** `pii/<PII>/pdfft`. The PII comes from the `linkinghub` redirect.
- **Atypon `/doi/pdf/<doi>`:** ACM, SIAM, T&F, SAGE, ACS, PNAS, Science, NEJM, INFORMS. ASM and World Scientific add `?download=true`.
- **De Gruyter:** `degruyterbrill.com/document/doi/<doi>/pdf`.
- **Thieme:** `thieme-connect.com/products/ejournals/pdf/<doi>.pdf`.
- **Project Euclid and SPIE:** the landing URL's `.full` becomes `.pdf`.
- **BMJ:** `<landing>.full.pdf`.
- **AMS:** `<landing>/<PII>.pdf`.
- **RSC, Emerald and OUP:** the PDF id is not in the DOI, so use `citation_pdf_url` from the page.

The full tables (36 platforms, each with a landing→PDF regex and a verified example) are in the research reports listed under Sources. Turn them into `capture/pdfUrlRules.ts`, with one unit test per rule.

---

## 3. Implementation plan: open access

Steps in order of return. Each is small enough to ship alone.

1. **Wire in the four resolvers.**
   - Add them to `resolverChain.ts`, with the identifier-learning resolvers first (pubmed, openalex, semanticScholar, europePmc) so pmc and arxiv can use what they learn.
   - Make `captureService.findPdf` pass `title`, `authors` and `year` from the draft.
   - Add unit tests with mocked `fetch`.
   - Expected gain: +6 correct PDFs on the corpus.
2. **Run lookups in parallel.**
   - Lookups (Stage A): run them concurrently with a 3 s cap.
   - Downloads: at most 3–4 at a time, a 10 s time-to-first-byte limit, 30 s per URL and a global limit of about 40 s.
   - Accept the first verified `%PDF-`. Prefer a better-ranked candidate that is still in flight, with a short hold.
   - Target: "not found" in under 3 s when no candidate exists, which is what the instant pop-up needs.
   - Keep `resolvePdf(ctx, fetchOpts, attempts)` and the `attempts` log unchanged, because the "not found" dialog reads them.
3. **Bot-wall detection.**
   - Extend `isBotCheck` with the signatures in 2.2, on any status.
   - Route those URLs to the helper tab.
   - In a real browser this is probably the largest single gain (chemistry, social science, Cloudflare publishers), but Node cannot measure it.
4. **Publisher rules.**
   - Create `capture/pdfUrlRules.ts` with `publisherPdfUrls(doi)`, `landingPdfUrls(url)` and `canonicalUrl(url)`.
   - Apply `landingPdfUrls` to every landing URL: the tab, doi.org redirects and the aggregators' landing pages.
5. **PMC.**
   - Try the S3 bucket first.
   - Then solve the proof-of-work, either with the `cookies` permission or inside the helper tab.
   - Send all NCBI calls through one queue at no more than 3 requests/s.
6. **Title-only twins.** For papers without a DOI (NeurIPS, ICML, ICLR):
   - First try arXiv by title plus surname.
   - Then OpenAlex `autocomplete`, which is free.
   - Gate every hit with `sameWork`.
7. **Old-style arXiv ids.** Recognise `hep-th/9711200` and similar ids in `doiDetector` and `pageFacts`.
8. **Keep the measurement in the repo.**
   - Move the corpus and runner into `packages/browser/tools/pdf-eval/` and add a `pnpm eval:pdf` script.
   - Run it before and after each step above.

---

## 4. Using access the user already has (Paperpile parity)

### 4.1 What Paperpile and Zotero do

- **Paperpile:**
  - Downloads through the browser, so campus IP ranges and existing publisher logins apply.
  - EZproxy support: the user enters a proxy URL with a `$@` placeholder where the target URL goes.
  - Several proxies can be configured and switched on or off from a menu.
  - When a PDF cannot be accessed, it retries the download through the active proxy.
- **Zotero Connector:**
  - Supports hostname-style EZproxy.
  - Detects the proxy when the user signs in to it and offers to save it.
  - Then rewrites known hosts through it automatically, and has a "Reload via Proxy" action.

### 4.2 Types of access and how LabShelf can use each

| Access | How it reaches the publisher | LabShelf today | To add |
|---|---|---|---|
| **IP** (campus network, institutional VPN, Periódicos CAPES on campus) | Any request from the user's machine | Works for background requests; no cookie is needed | Nothing specific. Missing publisher URL rules are what lose these PDFs today (steps 3.3 and 3.4). |
| **Publisher login** (personal subscription, or "Access through your institution" via Shibboleth or CAFe) | Session cookies on the publisher's domain | Background `fetch` with `credentials: "include"`. Chrome and Firefox send SameSite=Lax cookies on extension requests to hosts the extension has permission for. A fetch from inside the user's tab (`fetchInTab`) is used only when the candidate is on the tab's own site. | (a) Classify a login or paywall page as a separate outcome (`login`). (b) Retry those candidates through the helper tab: a real page load uses the first-party cookie jar, unlike Firefox's partitioned background requests (UNVERIFIED, test it). (c) A manual test in both browsers (4.4). |
| **EZproxy, prefix style** (`https://login.ezproxy.uni.edu/login?url=<target>`) | Proxy session cookie | Not supported | Settings, "Library proxy": a list of `{ name, template, enabled }`, where the template holds `$@` (the same convention as Paperpile, so users can copy their library's string). After a `login` or paywall outcome on a publisher host, retry `template.replace("$@", url)`. |
| **EZproxy, hostname style** (`www-nature-com.ezproxy.uni.edu`) | Proxy session cookie | Not supported | Rewrite rule: replace dots in the host with hyphens and append the proxy suffix. Auto-detect: when `capture.inspect` sees a tab host ending in a proxy suffix (it contains `ezproxy`, or matches a saved suffix), offer to save it, as Zotero does. |
| **OpenAthens** (`https://go.openathens.net/redirector/<domain>?url=<encoded target>`) | Single sign-on, then publisher cookies | Not supported | Same template mechanism as the prefix proxy. The first use is an interactive login, so it must open a visible tab. |
| **Shibboleth / SAML** (CAFe in Brazil) | Interactive login at the user's identity provider; ends with publisher cookies | Not supported | Cannot run silently. In the "PDF not found" dialog, add **Sign in through your institution**: open the article page in a visible tab and watch it (`tabs.onUpdated`). When the tab shows the PDF, or a page whose `citation_pdf_url` now downloads, fetch it from inside the tab and attach it automatically. This is the popup's existing "Attach this PDF" flow, automated. |
| **Library link resolver** (OpenURL: SFX, Alma, 360 Link) | The library's own page lists where the user has access | Not supported | Optional setting holding the resolver's base URL. A **Find via my library** button opens `<base>?rft_id=info:doi/<doi>&rft.atitle=…`. Cheap, and useful for the papers nothing else finds. |
| **LibKey (Third Iron)** | API: library id + DOI → direct PDF link through the library's subscriptions | Not supported | Optional, only if the user's library subscribes; it needs a library-specific token. UNVERIFIED. |

### 4.3 Proposed design

- **Settings → "Institutional access"** (stored in `storage.local` only, never sent anywhere):
  - a list of proxies (name, template with `$@` or hostname suffix, enabled);
  - an optional OpenURL resolver base;
  - "Retry through my proxy when a PDF needs a login" (on by default once a proxy exists).
- **Engine:**
  - A new fetch outcome `login`, meaning HTML that is neither a bot check nor a PDF. Signals: 401 or 403 without bot markers, or login markers such as a form posting a password, "Sign in", "Access through your institution", "Purchase" or "Get access".
  - After the open-access stages, candidates on publisher hosts that answered `login` go through an **access stage**:
    1. the helper tab (first-party cookies);
    2. each enabled proxy (URL rewritten);
    3. only then the "not found" verdict, whose dialog offers **Sign in through your institution** and **Find via my library**.
- **Permissions:**
  - `cookies` for the PMC proof-of-work, and to check whether a session exists before opening tabs.
  - Optionally `webNavigation` to watch the sign-in tab; `tabs.onUpdated` may be enough.
  - The existing `https://*/*` host permission already covers fetching.
- **Tests:**
  - The rewrite functions (prefix, hostname, OpenAthens) are pure; give each a unit test.
  - Test the outcome classifier on saved login pages: Springer, Elsevier, Wiley, IEEE, CAFe/Shibboleth.

### 4.4 Manual verification (needs a real browser and real access)

1. Sign in to Springer through the institution (or with a personal account). Capture a closed article:
   - from the toolbar popup (tab on the site);
   - from a Google Scholar result (no tab on the site, which tests background cookies).
2. Repeat in Firefox, which partitions cookies differently.
3. Off campus, with an EZproxy template configured: capture a closed Elsevier and a closed Wiley article.
4. CAFe: sign in through "Acesso CAFe" on one publisher, then capture from that publisher. Check that "Sign in through your institution" attaches the PDF without a second click.

---

## 5. Ask the author for a copy

When neither open access nor the user's own access yields the PDF, the remaining legal route is the author. Most publisher agreements let authors send a copy for someone's personal research, and authors usually answer. Paperpile has no such feature, so this is where LabShelf can do better for readers without any subscription.

### 5.1 Where the author's address comes from (cheapest first)

1. **The article page's own tags.**
   - `citation_author_email` appears next to `citation_author` on many publisher pages.
   - The probe (`pageProbeContentScript.probe`) and `htmlPage.parseHtmlPage` already collect every `<meta>`, so no new request is needed.
2. **`mailto:` links on the page** near "Correspondence", "Corresponding author" or an `*` footnote.
   - The probe does not collect these today.
   - Add a `mailtoLinks` field to `RawPage`, filled by both the probe and `parseHtmlPage`.
3. **PubMed.**
   - The `efetch` XML (`db=pubmed&retmode=xml`) often carries "Electronic address: …" inside an `<Affiliation>`.
   - The PMID is already known for biomedical papers, and it goes through the same NCBI queue as section 3 step 5.
4. **Repository "Request a copy".**
   - DSpace and EPrints repositories hosting an embargoed or closed item show a "Request a copy" link that emails the author through the repository.
   - When a repository landing page found by OpenAlex or Unpaywall has one, offer that link instead of an address (UNVERIFIED across repositories).
5. **None found.** Offer to open the article page, where the address is usually printed.

For an existing paper (the library's "Find PDF"), the address comes from the same sources applied to its landing page. `capture/recordCapture.draftFromRecord` already fetches that page.

### 5.2 Flow

- **Two entry points:**
  - the "PDF not found" dialog (popup, Google Scholar, library "Add");
  - the library's "No PDF" detail pane.
  
  Both get an **Ask the author** button when an address or a request link exists.
- **Clicking it opens a prefilled email in the user's own mail client** (a `mailto:` URL). The user reviews it and presses Send. LabShelf never sends mail by itself:
  - no account access is needed;
  - nothing can be sent in bulk;
  - the user decides every time.
- **The message** is short and editable:
  - Subject: `Request for a copy of "<title>"`.
  - Body: the full citation, the DOI link, "for my personal research", the user's name and affiliation (from Settings), and thanks.
  - Default language English, with a Portuguese and Spanish template selectable in Settings.
  - Stay under about 1,800 characters: some mail clients truncate long `mailto:` URLs.
- **After the click**, the paper records when the request was made. The detail pane then says "PDF requested from the author on <date>", which prevents duplicate requests.
- **When the reply arrives**, the user drops the PDF on **Attach PDF…**, which already exists.

### 5.3 Data

- `PaperRecord.pdfRequestedAt?: string` (ISO date), written to `metadata.yaml` and read back by `recordFromYaml`, so it syncs to VS Code.
- The author's address is not stored. It is looked up again when needed, which avoids keeping third parties' personal data.
- Settings: requester name, affiliation, template language. All stay in `storage.local`.

### 5.4 Modules

| Piece | Where | Kind |
|---|---|---|
| `authorEmails(raw: RawPage): AuthorContact[]` from meta tags and `mailto:` links | `capture/authorContact.ts` | pure, unit-tested |
| `emailFromAffiliation(text)` for PubMed's "Electronic address:" | same file | pure, unit-tested |
| `requestCopyMailto(paper, requester, lang)`, with correct encoding and the length cap | `capture/requestCopy.ts` | pure, unit-tested |
| `paper.authorContact { id }` → `{ contacts, requestCopyUrl?, articleUrl? }` | `background/index.ts` | runtime message (extension pages only, like `paper.findPdf`) |
| Ask the author button, "requested on" line | `library-page/views/detailSections.ts`, popup, Scholar dialog | UI |
| `pdfRequestedAt` round trip | `core/types/paperRecord.ts`, `storage/paperRecordStore.recordFromYaml`, `BibTeXService` | data |

### 5.5 Tests and spec

- **Unit tests:**
  - address extraction from saved pages of 5 publishers;
  - PubMed affiliation strings (single and multiple addresses, trailing punctuation);
  - `mailto:` encoding of quotes, accents and line breaks, and the length cap.
- **Spec:** extend `documents/specs/browser/capture.spec.yaml` and `library-page.spec.yaml` with the flow and the `pdfRequestedAt` key.

---

## 6. Paperpile parity checklist

| Capability | LabShelf |
|---|---|
| One-click save from any article page, PDF tab or Google Scholar | Have |
| Metadata from registries (CrossRef, arXiv, PubMed) with page fallback | Have |
| Honest "no PDF" state, retry later (Find PDF), attach a local file | Have (this branch) |
| Ask before saving without a PDF | Have (this branch) |
| Open-access discovery (Unpaywall, CrossRef) | Have |
| OpenAlex, Semantic Scholar, Europe PMC, PMC, title twins | Written, not wired (section 3, steps 1, 5, 6) |
| Publisher-specific PDF URL rules ("recipes") | Partial (about 20 DOI prefixes); research covers about 36 platforms (step 4) |
| Background tab for bot checks | Partial (one site, Cloudflare/Akamai only) (step 3) |
| Use the user's publisher login | Partial: works when cookies reach background requests; no fallback yet (4.2) |
| Library proxy (EZproxy, OpenAthens) with automatic retry | Missing (4.2, 4.3) |
| Guided institutional sign-in, then auto-attach | Missing (4.2) |
| Library link resolver (OpenURL) | Missing (4.2) |
| Ask the author for a copy (prefilled email, "requested on" state) | Missing; Paperpile has no equivalent (section 5) |

---

## 7. Sci-Hub, LibGen, Anna's Archive

- **What exists.** `capture/resolvers/scihubResolver.ts` is the user's existing opt-in Sci-Hub source:
  - off by default;
  - controlled by `enableSciHub` and `sciHubMirror` in the options page;
  - consulted last, only when a DOI is known.


---

## 8. Open questions

- Does Firefox attach the publisher's cookies to background-script requests with Total Cookie Protection on? The answer decides how often the helper tab is needed (4.4 item 2).
- Is the `cookies` permission worth the extra install prompt? PMC can also be served from inside the helper tab.
- Where should the evaluation corpus live in the repository, and should it run in CI? (It makes network calls, so probably manual only.)

## Sources

- Paperpile: [Access content off campus through your library proxy server](https://paperpile.notion.site/Access-content-off-campus-through-your-library-proxy-server-021013616c9046a2a10c8022137d244a), [Troubleshooting PDF downloads](https://paperpile.notion.site/Troubleshooting-PDF-downloads-0c84843b3fe14ae2a7293bf6e4eae25f), [Paperpile for Firefox](https://addons.mozilla.org/en-US/firefox/addon/paperpile-addon/)
- Zotero proxy detection: [Zotero forums](https://forums.zotero.org/discussion/99900/zotero-proxy-detection-for-the-oclc-proxy), [Automatic proxy support](https://forums.zotero.org/discussion/4124/automatic-proxy-support)
- EZproxy URL methods: [Aaron Tay, "Adding ezproxy to the url – 5 different methods"](https://aarontay.substack.com/p/adding-ezproxy-to-url-5-different)
- OpenAthens: [How the redirector works](https://docs.openathens.net/libraries/how-the-redirector-works)
- Cookies on extension requests: [WebKit bug 218002](https://bugs.webkit.org/show_bug.cgi?id=218002) (Chrome and Firefox send SameSite=Lax cookies with extension API calls; Safari does not)
- LabShelf live research, 2026-10-07: open-access API reports A and B, and publisher pattern reports A and B (session scratchpad, not yet in the repository).
