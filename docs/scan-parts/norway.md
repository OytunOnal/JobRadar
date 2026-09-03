# Source scan: Norway

Scope: Norway only, tech roles, visa-sponsorship bias. Primary sources only —
every row below names a URL that was actually fetched, with the status code and
payload size seen. Marketing pages and "best job boards" listicles were not
accepted as evidence; a docs page claiming an API was never enough, the API had
to answer. Where `WebFetch` was refused, the URL was retried from Node with a
desktop-Chrome User-Agent before the site was declared closed.

Already covered and therefore out of scope: sweden (Arbetsförmedlingen JobTech),
thehub, eures, arbeitnow, remotive, remoteok, jobicy, himalayas, weworkremotely,
freehire, workingnomads, themuse, adzuna, jsearch/indeed, linkedin, nofluffjobs,
and the ~30 ATS platforms that already have discovery adapters.

Scanned 2026-09-03.

## Findings

| Board / source | Type | Machine door? | Verified URL | Visa relevance | Verdict |
| --- | --- | --- | --- | --- | --- |
| **NAV Job Vacancy Feed** (`pam-stilling-feed`) — the national vacancy database behind arbeidsplassen.nav.no | Official public employment service, Arbeids- og velferdsetaten (NAV) | **Yes — a complete, keyless-in-practice JSON feed, verified end to end.** Bearer-token API, but the token is **self-serve and public**: `https://pam-stilling-feed.nav.no/api/publicToken` → **200**, body is prose (`"Current public token for Nav Job Vacancy Feed:"`) with a JWT appended — extract with `/ey[\w-]+\.[\w-]+\.[\w-]+/`, do **not** send the whole body as the header (it throws `invalid header value`). JWT decodes to `aud: feed-api-v2`, `iss: nav-no`, `exp` ≈ 35 days out | `https://pam-stilling-feed.nav.no/api/v1/feed` → **200**, `application/json`, **471,960 bytes**. JSON-Feed 1.0 envelope: `{version, title:"Stillingsfeeden fra arbeidsplassen.no", home_page_url, feed_url, next_url, id, next_id, items[]}` — a **linked list of pages via `next_url`/`next_id`**, so it replays the whole archive from 2023 forward. `?last=true` → **200**, jumps to the newest page (verified: 1 item, `status:"ACTIVE"`, `sistEndret:"2026-09-03T08:46:26"` — same morning as this scan). Each item carries `_feed_entry {uuid, status ACTIVE/INACTIVE, title, businessName, municipal, sistEndret}`. Detail: `https://pam-stilling-feed.nav.no/api/v1/feedentry/{uuid}` → **200, 11,883 bytes** for `36b0f3bc-…` ("Researcher in Solar Physics", University of Oslo), returning `ad_content {uuid, published, expires, updated, workLocations[{country,address,city,postalCode,county,municipal}], contactList[{name,email,phone,title}], title, description (full HTML)}`. `robots.txt` at `https://arbeidsplassen.nav.no/robots.txt` → **200**, `User-agent: *` / `Disallow:` (**empty value = allow all**) plus a sitemap; **no ClaudeBot/GPTBot/CCBot ban** | **High, indirectly.** No sponsorship field, but this is the *entire* Norwegian vacancy pool including every public-sector and university role — the segment that actually sponsors skilled workers — and `description` is full HTML, so our own visa/English-language classifiers get real text to judge | **adapter-worthy — top pick for Norway** |
| **finn.no** | The dominant Norwegian classifieds site, incl. the largest jobs vertical | **No usable door — this is the honest answer.** No public API, no RSS, and the results are **client-rendered**. `https://www.finn.no/job/fulltime/search.html?occupation=0.23` 302s to `https://www.finn.no/job/search?occupation=0.23` → **200, 794,308 bytes**, but the only JSON-LD is `BreadcrumbList` + `Organization` — **zero `JobPosting`**, and **no ad-detail URLs are extractable from the HTML at all** (no `finnkode=`, no `/job/…/ad.html` links; the only `/job/` hrefs are `search`, `browse.html` and two `podium-resource` internals). So the ad list never reaches the server-rendered markup | `https://www.finn.no/robots.txt` → **200**. Relevant rules: `User-agent: GPTBot` / `Disallow: /job/`; a grouped `GPTBot` + `OAI-SearchBot` + `ChatGPT-User` block disallowing `/job/salary/`; and site-wide `Disallow: /job*industry=*occupation=*` plus `Disallow: /job/employer/company/*activeAds*`. **ClaudeBot is not named**, so we are not banned by name — but the operator's intent toward AI crawlers on `/job/` is explicit | Would be the highest-volume Norwegian source, but no visa facet exists | **skip** — the biggest board in Norway has no machine door. Note the overlap: NAV's feed already carries the employer-posted supply, and finn.no's paid ads are largely the same employers |
| **kodejobb.no** (the board behind kode24.no/jobb) | Norway's tech-media job board — `kode24.no/jobb` **302s to `https://kodejobb.no/`** | **Yes — `JobPosting` JSON-LD on detail pages, confirmed by fetch.** `https://kodejobb.no/robots.txt` → **404** (no file = no restriction); `https://www.kode24.no/robots.txt` → **200, 24 bytes**, `User-agent: *` / `Disallow:` (**empty = allow all**). Listing `https://kodejobb.no/stillinger` → **200, 178,628 bytes**, SSR, **17 detail links inline** as `/stillinger/{company-slug}/{uuid}`, page text says "viser 18 ledige stillinger". Detail `https://kodejobb.no/stillinger/nav/7e4231ea-454d-459b-8bdb-0420ff08dac7` → **200, 118,595 bytes, 1 JSON-LD block, `@type: JobPosting`** with `title`, `description`, `identifier`, `datePosted: 2026-09-01`, `validThrough: 2026-09-22`, `employmentType: full-time`, `hiringOrganization` | Low-to-moderate — no visa facet, and the ads are Norwegian-language; but **100% developer roles**, no filtering needed | **park** — cleanest small door in Norway (1 listing fetch + ~18 detail fetches sweeps the entire board), but **18 live jobs** does not justify an adapter yet. Revisit if the count grows |
| **NAV "Ledige stillinger publisert av NAV"** (the pre-2024 dataset) | Official open-data listing on data.norge.no | Superseded | Catalogued at `https://data.norge.no/en/datasets/42dc3fe7-46b6-3674-8301-60b6aab84ef5/…` whose own title reads "**Avvikles 2024, se dokumentasjon for nytt API**" (decommissioned 2024, see docs for the new API). The replacement *is* the `pam-stilling-feed` row above | n/a | **already-covered-via-NAV feed** — do not build against the old dataset |
| **UDI approved/pre-approved employer register** | The visa lead we were asked to chase | **Does not exist.** `https://www.udi.no/en/word-definitions/approved-employer/` → **404** (empty body). Targeted search for `"godkjent arbeidsgiver"` / `"forhåndsgodkjent"` employer registers returned only UDI guidance pages (`/en/want-to-apply/work-immigration/skilled-workers/`, `/en/word-definitions/employers-employing-someone-who-is-not-an-eueea-national-/`) and union/employer-confederation pages — **no list, register, or downloadable file of approved employers** | n/a | **skip — dead lead. Confirms `src/lib/visa/sponsors.ts`**: Norway certifies nothing publishable. Under the skilled-worker route the employer merely confirms a concrete job offer per application; there is no standing licence, so there is nothing to publish |
| **NITO (Norwegian Society of Engineers) job board** | Union job board | **No board found at the expected path.** `https://www.nito.no/robots.txt` → **200**, permissive (`Disallow: /episerver/`, `/util/` only, no AI ban). But `https://www.nito.no/jobb/jobbtorget` → **404** (JSON-LD confirms it: `@type: WebPage`, `name: "Siden ble ikke funnet"`). `https://jobbtorget.nito.no/robots.txt` → DNS/TCP `fetch failed` — host does not resolve | Low — members-oriented, Norwegian-language | **skip** — no reachable board; union job boards are member-gated by design and the volume would be trivial beside NAV |
| **relocate.me** (Norway slice) | Relocation/visa-focused board, pan-EU | Partial — SSR HTML only. `https://relocate.me/robots.txt` → **200**, permissive (disallows only `/install/`, `/manager/`, `/uploads/`; declares two sitemaps). `https://relocate.me/international-jobs/sweden` → **200, 78,065 bytes**, SSR, but the **only JSON-LD is `BreadcrumbList`** — no `JobPosting`, so cards must be scraped from markup | **Highest by construction** — relocation and visa support are the site's entire premise | **park — and not a Nordics item.** It is pan-EU; scoping an adapter to NO/SE would waste it. Belongs to a cross-country issue, not #28 |

## Why the NAV feed is the find

Three properties, all measured above, make it materially better than a scrape:

1. **It is the whole country, officially.** Arbeidsplassen is NAV's national
   vacancy database — the same pool finn.no competes with, minus the wall. The
   feed page fetched was 471 KB of items in one request.
2. **It is incremental by design.** The JSON-Feed envelope is a linked list:
   `next_url`/`next_id` walk forward page by page, and `?last=true` jumps
   straight to the newest page. So the first run backfills and every later run
   resumes from a stored `next_id` — no re-crawl, no date-window guessing. This
   is exactly the shape our `ingest/` pass wants.
3. **Detail entries are complete.** `feedentry/{uuid}` returns full description
   HTML, structured `workLocations` (country, address, city, postal code,
   county, municipality), publish/expire/update timestamps, and a contact list.
   Nothing needs to be scraped from a rendered page.

Two operational notes for whoever builds it. The token endpoint returns **prose
with the JWT embedded**, so regex the JWT out rather than trimming the body —
passing the raw body to `Authorization` throws `Headers.append: … is an invalid
header value`. And the public token **rotates**; NAV asks builders to register
for a stable key at `nav.team.arbeidsplassen@nav.no`, so the adapter should
re-fetch `publicToken` on a 401 rather than hard-coding one.

## Answers to the three questions

**1. Biggest tech-relevant private boards.** **finn.no is the dominant site and
it is closed** — I want to be blunt about this rather than optimistic. Its
search page renders 794 KB of HTML that contains no `JobPosting` JSON-LD and not
a single ad link; the listings arrive by client-side fetch. There is no public
API and no RSS, and robots explicitly disallows `/job/` for GPTBot. **kode24.no
has moved its jobs to kodejobb.no**, which is genuinely open (no robots.txt,
`JobPosting` JSON-LD on every detail page) but carries **18 jobs**. **NITO** has
no reachable board. So Norway's private tier offers one closed giant and one
open pinhole.

**2. Public/official — this was the high-value bet and it paid.** NAV's
`pam-stilling-feed` is a live, complete, incrementally-paginated JSON feed of
the national vacancy database, and `arbeidsplassen.nav.no/robots.txt` allows
everything with no AI-crawler ban. The "token required" framing in the docs is
much weaker than it sounds: the public token is served by an open endpoint and
worked immediately. The older data.norge.no dataset is decommissioned; the feed
is its replacement.

**3. Visa registers — negative, and the negative is now verified.** Norway
publishes **no** list of approved, certified or pre-approved employers. The
UDI page for the concept 404s and no register exists anywhere on udi.no. The
skilled-worker route works per-application, with the employer confirming a
concrete job offer, so there is no standing licence to publish. **The claim in
`src/lib/visa/sponsors.ts` stands for NO and needs no edit.**

## Checked, not worth it

- **finn.no** — no API, no RSS, ad list is client-rendered (`/job/search`
  returns 794 KB with zero `JobPosting` JSON-LD and zero ad links); robots
  disallows `/job/` for GPTBot. The one genuinely big Norwegian board, and
  there is no polite door.
- **UDI approved-employer register** — does not exist; `/en/word-definitions/approved-employer/`
  404s. Dead lead, and a confirmation of existing code.
- **NITO jobbtorget** — `www.nito.no/jobb/jobbtorget` 404s and
  `jobbtorget.nito.no` does not resolve.
- **data.norge.no NAV vacancies dataset** — self-declared decommissioned in
  2024; superseded by the feed we are adopting.
- **kodejobb.no** — parked, not dropped: technically the tidiest scrape target
  in Norway, but 18 live postings.
- **relocate.me** — parked and deliberately deferred: relocation-focused (so
  maximal visa relevance) and robots-permissive, but pan-EU, and scoping it to
  Norway alone would throw away most of its value.
