# Source scan: Slovenia

Scope: Slovenia only, tech roles, visa-sponsorship bias (issue #31).
Slovenia is small in this group — the answer below is honestly brief, backed
by counted numbers rather than padded. Every claim carries the URL fetched,
a verbatim quote where the payload offered one, and today's date
(2026-09-03). Lines are marked **found** or **inferred**.

Already covered and out of scope, per the brief: EURES, NoFluffJobs,
justjoin.it, arbeitnow, remotive, remoteok, jobicy, himalayas,
weworkremotely, freehire, workingnomads, themuse, adzuna, jsearch/indeed,
linkedin, and the ~31 ATS discovery adapters.

## Headline

**No work-permit/sponsor register exists.** Slovenia's open-data portal and
the labour ministry's own dataset catalog were searched directly; the two
closest hits are registers of licensed *temp-staffing agencies* (domestic and
foreign), not of employers holding permits for third-country nationals — the
same wrong-shape result found in Bulgaria and Croatia. On the boards side,
**Optius.com** is the find: a 1,230-URL sitemap with full `JobPosting`
JSON-LD (employer name included) on a server-rendered page, no JS required.
The largest Slovenian board by volume, **MojeDelo.com** (3,921 job URLs in
its sitemap), turns out to be closed — every URL renders an identical SPA
shell with no server-side content.

## Findings

| Source | Type | Machine door? | Exact URL fetched | Employer name published? | Visa relevance | Verdict |
|---|---|---|---|---|---|---|
| **Work-permit/sponsor register** (podatki.gov.si, MDDSZ) | Government register | No — searched directly, nothing found | `https://podatki.gov.si/api/3/action/package_search?q=...` (tried `delovna dovoljenja`, `tuji delavci`, `delovno dovoljenje`, `zaposlovanje tujcev`, `tujci`, `migranti trg dela`, `tuja delovna sila` — 1–2 unrelated results each); MDDSZ organization page `organization_show?id=republika_slovenija_ministrstvo_za_delo_druzino_socialne_zadeve_in_enake_moznosti` (~80 datasets, two adjacent but wrong-shape: "Register domačih pravnih in fizičnih oseb za opravljanje dejavnosti zagotavljanja dela delavcev uporabniku" and its "tujih" (foreign) counterpart — both licenses for **temp-staffing agencies**, not employers of third-country nationals) | n/a | Highest, if it existed | **skip — confirmed absent** |
| **ZRSZ** (Zavod RS za zaposlovanje) main site | National employment service, institutional | Yes for CMS content, no for jobs — `robots.txt` permissive, declares `Sitemap: https://www.ess.gov.si/sitemap.xml`, but that sitemap covers only CMS pages, not job listings | `https://ess.gov.si/robots.txt` (200) | n/a | High by intent | **already-covered-via-eures** for whatever it feeds |
| **poiscidelo.si / zadelodajalce.si** (ZRSZ's actual job-search backend) | National employment service, vacancy search | No — legacy ASP.NET WebForms (`aspnetForm`, Telerik `WebResource.axd`, postback), no `robots.txt` on either host (404, i.e. no file) | `poiscidelo.si` and `zadelodajalce.si` homepages fetched (200, confirmed WebForms markup); `robots.txt` on both → 404 | n/a | High by intent | **already-covered-via-eures** — not independently machine-readable |
| **Optius.com** | General board, IT-relevant subset | **Yes.** `robots.txt`: `Disallow: /admin`, `Allow: /`, `Sitemap: https://www.optius.com/sitemap.xml` → index lists `Job/1` (1,000 URLs) + `Job/2` (230 URLs) = **1,230 job URLs** (counted), plus 6 `Company` sub-sitemaps. No AI-crawler ban | `https://www.optius.com/robots.txt` (200); sitemap index and `Job/1`, `Job/2` sub-sitemaps (200); sample `https://www.optius.com/iskalci/prosta-delovna-mesta/proizvodni-tehnik-mz-959472-959472/` (200, 118,377 bytes) — full `application/ld+json` `JobPosting`: title, description, `hiringOrganization.name` ("Wooshin LaPache d.o.o."), `hiringOrganization.url`, salary, location, dates | **Yes — structured** | Medium (general board, some tech) | **adapter-worthy — top SI pick** |
| **zaposlitev.info** | General/WordPress board (WPJobBoard) | Yes, small. `robots.txt` blocks `PerplexityBot` by name (not Claude); `Sitemap: https://zaposlitev.info/job-sitemap1.xml` → **101 job URLs** (counted) | `https://zaposlitev.info/robots.txt` (200); `job-sitemap1.xml` (200); sample job page — full JSON-LD `JobPosting`, `hiringOrganization.name` ("Mercator d.o.o.") | **Yes — structured** | Low-medium (small, general/retail-skewed) | **park** |
| **kariera.si** | General board | No structured door — server-rendered but small (`sitemap.xml` = 164 URLs total, all page types) and no `JobPosting` JSON-LD found on a sampled detail page. `robots.txt` uses the newer Cloudflare "content-signal" comment block, no path restrictions, no bot names | `https://kariera.si/robots.txt` (200); `sitemap.xml` (200, 164 URLs) | Unconfirmed | Low | **skip — too small, no structured data** |
| **mojedelo.com** | General board, **largest in Slovenia by sitemap volume** | No — **closed door despite a huge sitemap**. `robots.txt` permissive (`Allow: /`, `Sitemap: http://www.mojedelo.com/sitemap.xml`). Sitemap has **3,921 `/oglas/` (job) URLs and 6,168 `/podjetje/` (company) URLs** (counted) — but every sampled URL returns an identical generic SPA shell (React/Vue root div, bare `<title>Moje delo</title>`, no per-page meta, no JSON-LD), fed by a private backend at `api.mojedelo.com` (tenant-based white-label job-board SaaS, seen via `jb.globals.js`/`jb.employers.js` config references). The API host's own `robots.txt` declares a broken `Sitemap: undefined/sitemap.xml` | `https://www.mojedelo.com/robots.txt` (200); `sitemap.xml` (200, 3,921+6,168 URLs counted); multiple sampled `/oglas/` URLs all returned the same SPA shell | Unconfirmed — not visible without JS execution or the private API | High by volume, currently unreachable | **park — footprint recorded for a later JS-render or API reverse-engineering pass, not an adapter today** |
| **zaposlitev.net** | General board | Unreachable | Every scheme tried (`https://`/`http://`, `www.`/bare) returned `fetch failed` | Unknown | Unknown | **skip — appears defunct** |

## Checked, not worth it

- `poiscidelo.si` / `zadelodajalce.si` — legacy ASP.NET WebForms, no `robots.txt`, no machine door.
- `zaposlitev.net` — unreachable on every URL form tried, likely defunct.
- `kariera.si` — only 164 URLs total (all page types), no structured data.
- `podatki.gov.si` searches for `tuji delavci`, `delovna dovoljenja`, `delodajalci`, `zaposlovanje tujcev`, `tujci`, `migranti trg dela`, `tuja delovna sila` — no employer-level permit dataset under any of these queries.

## AI-crawler bans

Only one found in this country: `zaposlitev.info/robots.txt` disallows
`PerplexityBot` specifically. No `ClaudeBot`, `Claude-Web`, or `anthropic-ai`
ban was encountered anywhere in this scan.

## Answer to the permit-register question

No. Slovenia's open-data portal (podatki.gov.si) and the labour ministry's
own ~80-dataset catalog were searched directly for work-permit/foreign-worker
terms; the closest hits are licenses for domestic and foreign temp-staffing
agencies (a different regulated entity from an employer holding a permit for
a third-country national), the same wrong-shape result found in Bulgaria and
Croatia. No equivalent to the UK/IE/NL/DK/PT sponsor registers exists in
Slovenia.
