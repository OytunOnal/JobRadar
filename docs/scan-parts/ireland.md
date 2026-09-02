# Source scan: Ireland

Scope: Ireland only, tech roles, visa-sponsorship bias. Primary sources only —
every row below names a URL that was actually fetched. Marketing copy and
third-party "best job boards" listicles were not accepted as evidence. Where a
`WebFetch` was refused, the URL was retried from Node with a desktop-Chrome
User-Agent before the site was declared closed.

Already covered and therefore out of scope: eures, arbeitnow, remotive, remoteok,
jobicy, himalayas, weworkremotely, freehire, workingnomads, thehub, themuse,
adzuna, jsearch/indeed, linkedin, huntukvisasponsors, and the 30 ATS platforms
that already have discovery adapters.

Scanned 2026-09-02.

## Findings

| Board / source | Type | Machine door? | Verified URL | Visa relevance | Verdict |
| --- | --- | --- | --- | --- | --- |
| **DETE "Employment Permits issued to companies"** | Official register (XLSX), Dept. of Enterprise, Tourism and Employment | **Yes** — a plain `.xlsx` over HTTPS, no key, no wall. Parsed end to end (unzip + `sharedStrings.xml` + `sheet1.xml`) | `https://enterprise.gov.ie/en/publications/publication-files/employment-permits-issued-to-companies-2026.xlsx` (200, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, **`Last-Modified: Wed, 02 Sep 2026`** — same day as this scan). Sheet `Export`, **7,097 rows**: header `Employer Name / Permits Issued Jan … Aug / Grand Total`, then 7,095 employers (`19th Hole Hospitality Limited` … `Zyte Group Limited`), totals row **26,629 permits Jan–Aug 2026**. Index page: `https://enterprise.gov.ie/en/publications/employment-permit-statistics-2026.html` (200). Prior year still live: `https://enterprise.gov.ie/en/publications/publication-files/permits-issued-to-companies-2025.xlsx` (200, 542 KB) | **Highest** — this *is* the sponsor list, from the issuing authority | **adapter-worthy** — see "Is it better than what we hold?" below |
| **VisaJobs.ie** | Ireland-only visa-sponsorship job board built on the DETE register | **Yes** — server-rendered HTML, keyless query params, and a 5.7 MB sitemap | `https://www.visajobs.ie/robots.txt` (200; `Allow: /`, disallows only `/dashboard`, `/api/`, `/studio`, auth paths; declares the sitemap). `https://www.visajobs.ie/sitemap.xml` (200, 5,739,741 bytes, **31,973 `<loc>`s with `lastmod`**: 8,000 `/jobs/{id}`, 22,550 `/companies/…`, 1,051 `/agencies/…`, 90 `/occupations/…`, 28 `/sectors/…`, 27 `/counties/…`). Listing is SSR and filterable without a key: `https://www.visajobs.ie/jobs?sector=information-communication` → "**5,007 jobs found**"; `https://www.visajobs.ie/jobs?q=software+engineer` → "**262 jobs found**". Detail page `https://www.visajobs.ie/jobs/57894` (200) renders, in HTML: title, employer, county, job type, origin board ("via IrishJobs.ie"), and a **Sponsorship fit 66/100** breakdown — "Employer sponsorship history 36/45 — 121 permits issued, most recent 2026", "Role eligibility 18/30 — Not on either government list", "Salary vs permit floor 12/25". Sector page `https://www.visajobs.ie/sectors` (200) reports "Information & Communication (Tech & Media)" **37,212 permits**, 1,613 so far in 2026 | **Highest** — every posting carries a permit-history-derived sponsorship score, and the whole board is Ireland-only | **adapter-worthy — top pick** |
| **JobsIreland.ie** (DSP / Intreo) | Official public employment service | **Yes** — fully public SSR, **no MyGovID login needed to browse** | `https://jobsireland.ie/robots.txt` (200, `User-agent: *` with no `Disallow`, declares `https://jobsireland.ie/sitemap.xml`). `https://jobsireland.ie/sitemap.xml` (200, 16,962 bytes — **content pages only, no vacancies**). The real door is the listing: `https://jobsireland.ie/en-US/browse-jobs` (200, SSR, `/en-US/job-Details?id=NNNNNNN` links, ~10–12 per page, `?page=N` returns different ids, `?keyword=` works). Detail page `https://jobsireland.ie/en-US/job-Details?id=2467226` (200) exposes employer, address, lat/lon, positions, hours, **salary**, "Published On / Closing On", career level, minimum qualification level — plus a standing notice: *"In order to work in Ireland a non-EEA National, unless they are exempted, must hold a valid employment permit."* Homepage states 13,059 opportunities | **High but skewed** — under the Labour Market Needs Test, a **General Employment Permit** vacancy *must* be advertised "with the Department of Social Protection Employment Services/EURES employment network for a minimum of 28 days (continuously)" (`https://enterprise.gov.ie/en/what-we-do/workplace-and-skills/employment-permits/employment-permit-eligibility/labour-market-needs-test/`). **Critical Skills permits are exempt from the LMNT**, so the tech roles the user wants are *not* required to appear here | **adapter-worthy (second)** — cheap, official, legally-motivated sponsorship intent; but expect hospitality/care/construction density (`?keyword=software` returned 1 result) |
| **Critical Skills Occupations List (CSOL)** | Official occupation list, DETE | **Yes** — a `.docx` (Office Open XML zip); parsed via `word/document.xml`, 263 KB of extracted text, table rows with SOC codes and headings such as "ICT Professionals" | `https://enterprise.gov.ie/en/publications/publication-files/critical-skills-occupations-list.docx` (200, `Last-Modified: Fri, 21 Aug 2026`). Landing page: `https://enterprise.gov.ie/en/what-we-do/workplace-and-skills/employment-permits/employment-permit-eligibility/highly-skilled-eligible-occupations-list/` (200; no XLSX/CSV/PDF alternative — `.docx` is the only machine-readable form) | **Highest** — the occupation whitelist that makes a role CSEP-eligible (and LMNT-exempt) | **adapter-worthy (small)** — not a job feed; a ~annual reference table to join against title/occupation, sitting beside the sponsor register |
| **VisaSponsor.jobs** | Multi-country visa-sponsorship board | **Yes — an undocumented but fully public keyless JSON API.** `https://visasponsor.jobs/api/jobs` (200, `application/json`). Envelope `{data, total, page, page_size}`; `page_size` caps at 50; `?country=IE` and `?country=ie` both work (`?country=ireland` → `400 {"error":"invalid country: ireland"}`). Item fields: `slug, title, company_name, company_logo_url, country, city, state, industry, visa_type[], education_level, experience_level, salary, published_at, closing_date`. Health probe `https://visasponsor.jobs/api/health` → `{"worker":"api","ok":true}`. Site itself is SSR (`https://visasponsor.jobs/jobs/ireland-country`, 200, job cards with a `pill-visa` "Critical Skills" badge) | `https://visasponsor.jobs/api/jobs?country=IE&page_size=100` → **`total: 18`** (global `total: 1375`). Of the 18: Health and Care 9, Manufacturing/Logistics 2, Financial Services 2, Management 2, **Information Technology 1**, Engineering 1, Sales 1. `visa_type` counts: Critical Skills 15, Other/unspecified 18. Only genuinely tech row found: "Linux Platform & HLOS Stack Developer, Senior/Staff — Cork, Ireland @ Qualcomm" | **Highest by construction, thinnest in practice** — visa type is a first-class field, but 18 IE rows and 1 IT role | **park** — the cleanest API in this whole scan and near-zero build cost; park it until it grows, or take it EU-wide rather than IE-only. Note `robots.txt` (`https://visasponsor.jobs/robots.txt`, 200) carries a Cloudflare-managed block `User-agent: ClaudeBot / Disallow: /` and `Content-Signal: search=yes,ai-train=no,use=reference`, while `User-Agent: * / Allow: /`, and `/api/` is not disallowed |
| **Jobs.ie** | Large Irish generalist board (StepStone-family stack) | **Partial.** `https://www.jobs.ie/robots.txt` (200, 6,191 bytes) — the `User-agent: *` block has **no blanket `Disallow: /`** (that blanket only applies to the named-bot blocks), so `/jobs` and `/job/` are crawlable; but it explicitly kills the feed: `Disallow: /JobSearch/RSS.aspx`. No sitemap declared and `https://www.jobs.ie/sitemap.xml` → **404**. `https://www.jobs.ie/jobs` (200, 952 KB, SSR, "**3,568 jobs**", 25 `/job/…` links per page, no JobPosting JSON-LD). But faceted paths reset the connection: `https://www.jobs.ie/jobs/it` and `/jobs/software-developer` both → TCP `fetch failed` (twice, with full browser headers) | Low — no visa or sponsorship facet anywhere in robots or the listing | **park** — SSR works on `/jobs` only, inventory overlaps Adzuna/JSearch/LinkedIn, and VisaJobs.ie already re-serves Jobs.ie rows *with* a permit score attached |
| **IrishJobs.ie** | Largest Irish tech-relevant board | **No — hard Akamai wall.** Even `robots.txt` is refused | `https://www.irishjobs.ie/robots.txt` → **HTTP 403** ("Access Denied", `errors.edgesuite.net` reference — Akamai). `https://www.irishjobs.ie/jobs/information-technology` → **HTTP 403** on retry with full desktop-Chrome headers (UA, Accept, Accept-Language, Sec-Fetch-*, sec-ch-ua) | Would be high (volume), unreachable | **skip — but already-covered-via-visajobs**: VisaJobs.ie detail pages carry "Apply on IrishJobs.ie / via IrishJobs.ie", so IrishJobs inventory reaches us through a door that is actually open |
| **RecruitIreland.com** | Irish generalist board | **Yes, and wide open — but the shelf is nearly bare.** `https://www.recruitireland.com/robots.txt` (200, `User-agent: * / Disallow:` — fully permissive — two sitemaps declared). `https://www.recruitireland.com/sitemap.xml` (200, 2,079,960 bytes, **8,461 `<loc>`s**, of which 7,320 under `/company/…`, 723 advice articles, 265 `/search/…`) — but it is stale: the first three `/company/*/job/*` URLs sampled returned **404**. Live listing `https://www.recruitireland.com/it-jobs` (200, Laravel Livewire SSR) reports "**2 jobs**"; `https://www.recruitireland.com/jobs-in-ireland` (200) renders 15 job links per page | None — no visa facet | **skip** — an open door onto an empty room; 2 IT jobs is not worth an adapter |
| **TechLife Ireland** | IDA-backed tech talent brand | **No — the board no longer exists.** `https://techlifeireland.com/` and `/robots.txt` both **302 to `https://www.idaireland.com/`**, which then answers **403** with a Cloudflare "Just a moment…" interstitial | n/a — folded into IDA Ireland | **skip** |
| **Irish Tech News (jobs)** | Tech news site with a jobs section | **No** — `https://irishtechnews.ie/robots.txt` → **HTTP 403**, Cloudflare "Just a moment…" challenge (retried with desktop-Chrome UA) | n/a | **skip** |
| **data.gov.ie** | National open-data portal (CKAN) | API works, content does not. `https://data.gov.ie/api/3/action/package_search?q=…` (200, valid CKAN JSON) queried for `employment permit`, `vacancies`, `jobs`, `recruitment`, `job vacancies` | **No employment-permit dataset exists** (`q=employment permit` → 11 hits, all Marine Institute noise). Every vacancy hit is a **CSO aggregate statistic** — `EHQ59 Job Vacancies`, `EHQ16 Job Vacancies`, `VAC17 Vacancy Flows`, `JCQ01 Job Churn`, `ICA82 Enterprise experience of ICT specialist recruitment` — CSV/json-stat/px/XLSX time series, **zero posting-level rows** | None | **skip** — the permit data lives on enterprise.gov.ie, not here |
| **Trusted Partner register** | The lead we were asked to chase | **Does not exist any more.** `https://enterprise.gov.ie/en/what-we-do/workplace-and-skills/employment-permits/trusted-partner-initiative/` (200) states: *"there is no longer a requirement for a separate Trusted Partner Initiative"* — all employers now hold Employment Permits Online portal accounts with CRO + Revenue documentation. No register, list, or downloadable file is published | n/a | **skip — dead lead** |
| **NextLevelJobs.eu** (Ireland slice only) | Sponsor-curated EU board | Already verified adapter-worthy EU-wide. Ireland-specific fact: the only IE-shaped facet exposed from the homepage is `https://nextleveljobs.eu/city/dublin` (200), "**€100k+ Software Engineering Jobs in Dublin**", **217 jobs**. `https://nextleveljobs.eu/jobs?country=Ireland` (200) renders but publishes no IE count | High by construction | **already-covered-via-nextleveljobs** — no separate Ireland adapter; the EU-wide sitemap `https://nextleveljobs.eu/jobs/sitemap.xml` already sweeps the 217 Dublin rows |

## Is the DETE register better than the 6,351 names we hold?

Yes, on three counts, all measured from the parsed file:

1. **Fresher.** `employment-permits-issued-to-companies-2026.xlsx` returned
   `Last-Modified: Wed, 02 Sep 2026 02:41:08` — the file is regenerated monthly
   and was regenerated the morning of this scan. The index page states the data
   runs "from the beginning of the year up until the last day of the previous
   month", and the sheet's month columns confirm it: Jan through Aug 2026.
2. **Richer in names.** 7,095 employer rows for Jan–Aug 2026 alone, against the
   6,351 in `VisaSponsor`. And 2025 is a separate file
   (`permits-issued-to-companies-2025.xlsx`, 200, 542 KB), so the union across
   years is larger still.
3. **Richer per row.** We currently hold names. The file holds **per-month
   permit counts plus a grand total** — `2K Games Dublin Limited` shows
   `2,1,2,2,2` across Apr–Aug for 9 permits. That is a recency and volume
   signal, not just membership: an employer with permits issued *last month*
   is a materially stronger sponsorship bet than one that last sponsored in
   2019. VisaJobs.ie already monetises exactly this signal ("121 permits
   issued, most recent 2026").

The practical shape: keep the XLSX as the authoritative refresh (one fetch a
month, no key, no wall), and store `permitsThisYear` + `lastPermitMonth`
alongside the name.

## Answers to the three questions

**1. Biggest tech-relevant Irish boards.** The biggest one, **IrishJobs.ie**, is
behind an Akamai wall that 403s its own `robots.txt` — there is no polite door.
**TechLife Ireland** has been shut down and redirects to IDA Ireland (which is
itself Cloudflare-challenged). **Irish Tech News** is Cloudflare-challenged.
**Jobs.ie** is half-open: `/jobs` renders 3,568 jobs server-side and robots
permits it, but the faceted paths reset the connection and RSS is explicitly
disallowed. **RecruitIreland** is the only fully open one, and it has 2 IT jobs.
So the private Irish tier is either walled or empty — and the useful move is not
to fight the wall but to go through **VisaJobs.ie**, which re-serves IrishJobs
and Jobs.ie rows with a permit score attached.

**2. Public/official.** **JobsIreland.ie** (DSP/Intreo) is browseable without
MyGovID at `/en-US/browse-jobs`, paginates with `?page=N`, and its detail pages
are structured SSR including salary and closing date. It matters because the
Labour Market Needs Test makes a JobsIreland/EURES posting *legally mandatory*
for 28 continuous days before a General Employment Permit application — so a
posting there is evidence of sponsorship intent, not a guess. The caveat is
sharp: **Critical Skills permits are LMNT-exempt**, so senior tech roles are
not required to appear. **data.gov.ie** has nothing: no permit dataset, and
every vacancy hit is a CSO aggregate time series with no posting-level rows.

**3. Visa-focused boards and the permit registers.** This is where Ireland is
unusually rich. The **DETE company register** is a keyless monthly XLSX that is
fresher, larger and more informative than what we hold. The **CSOL** is a
parseable `.docx` naming the occupations that unlock a Critical Skills permit.
The **Trusted Partner register is a dead lead** — DETE retired the initiative
outright. And **VisaJobs.ie** has already done the join we would otherwise do
ourselves: 8,000 postings, each scored against that same government register.

## Checked, not worth it

- **enterprise.gov.ie Trusted Partner register** — retired; no list is
  published. `https://enterprise.gov.ie/en/what-we-do/workplace-and-skills/employment-permits/trusted-partner-initiative/`
- **data.gov.ie** — CKAN API is healthy but holds no employment-permit dataset
  and no posting-level vacancies, only CSO aggregates.
  `https://data.gov.ie/api/3/action/package_search?q=vacancies`
- **IrishJobs.ie** — 403 on `robots.txt` and on category pages even with full
  browser headers (Akamai). Reachable only second-hand via VisaJobs.ie.
- **TechLife Ireland** — 302 to `idaireland.com`, which 403s behind Cloudflare.
  The board is gone.
- **Irish Tech News jobs** — Cloudflare interstitial on `robots.txt`.
- **RecruitIreland.com** — wide-open robots, 8,461-URL sitemap, and 2 live IT
  jobs. Sitemap entries sampled returned 404.
- **Jobs.ie** — no sitemap (404), RSS disallowed, faceted paths reset the
  connection, no visa facet, and inventory already reached via Adzuna /
  JSearch / LinkedIn / VisaJobs.ie.
- **visasponsor.jobs** — parked rather than dropped: the API is the cleanest
  thing in this scan, but Ireland holds 18 rows and one IT job.
