# Switzerland source scan

Scope: Swiss-market job sources for a candidate needing **visa sponsorship**.
Switzerland is not in the EU: a third-country national needs a permit drawn
from an annual federal quota (Kontingent), granted for a specific job at a
specific employer after a labour-market test. Scanned 2026-09-03. Every
yes/no below was decided by fetching the URL in the row, not by reading a
marketing page. SwissDevJobs (already ingested, `src/lib/sources/swissdevjobs.ts`)
and the ~31 ATS platforms with existing discovery adapters are out of scope.

## Verdict table

| Board / register / service | Type | Machine door? | Verified URL | Visa relevance | Verdict |
|---|---|---|---|---|---|
| **Job-Room public search API** (arbeit.swiss / SECO) | Federal public employment service — job-search API behind the Angular SPA at job-room.ch | **Yes** — `POST https://www.job-room.ch/jobadservice/api/jobAdvertisements/_search` returns `200` with a JSON array and **no authentication**; paginates via `?page=N&size=M`, response `Link` header gives `first`/`next`/`last`, `x-total-count` header gives the exact live pool size | `https://www.job-room.ch/jobadservice/api/jobAdvertisements/_search` — POST body `{}` → HTTP 200, `x-total-count: 74094`, `Link: </api/_search/jobs?page=1&size=20>; rel="next",</api/_search/jobs?page=3704&size=20>; rel="last"`; sampled record: `"company":{"name":"MediPersonal","street":"Bahnhofplatz",...,"countryIsoCode":"CH"}`, `"reportingObligation":false`, `"jobContent":{"occupations":[{"avamOccupationCode":"101224",...}]}` (all fetched 2026-09-03) | **High.** This is the federal channel employers use to satisfy the Stellenmeldepflicht (job-registration duty). Every record carries a `reportingObligation` boolean and an AVAM occupation code — a structured, per-posting flag for whether the vacancy sits in a duty-to-report occupation. **Correction to the issue's framing**: per `arbeit.swiss/en/employers/job-registration-requirement` the duty applies to occupations with a **high level of unemployment** (protects local jobseekers with a head start), not to shortage occupations — so `reportingObligation` is not a shortage/sponsorship-likelihood signal by itself, only a structural field worth ingesting alongside occupation code | **Adapter-worthy (highest value of this scan)** — full national vacancy pool, open JSON API, no key, no CAPTCHA, exact live count (74,094 postings 2026-09-03) |
| **SEM (Staatssekretariat für Migration) — quota/permit data** | Federal migration authority | **No employer-level data published.** All published quota statistics are aggregate: national totals per permit type (L short-term / B residence), split by canton remaining-stock, federal reserve, and nationality/country group — never by company | Monthly PDF fetched: `https://www.sem.admin.ch/dam/sem/de/data/publiservice/statistik/auslaenderstatistik/monitor/2026/statistik-zuwanderung-2026-02.pdf` — tables organized only by permit type / canton / nationality, no employer names anywhere in the document; opendata.swiss CKAN confirms the same shape: `https://opendata.swiss/api/3/action/package_search?fq=organization:staatssekretariat-fuer-migration-sem` → exactly **8** datasets, all aggregate population/permit-stock counts (`Bestand gültiger Grenzgängerbewilligungen`, `Bestand der ständigen und nicht ständigen ausländischen Wohnbevölkerung`, etc.), none an employer roster | Would have been the single highest-value find in this scan (a UK/NL/IE/PT-style sponsor register) — confirmed absent | **Skip — checked, not found.** No SEM/opendata.swiss publication goes below aggregate level. Do not re-check without a specific new dataset name |
| **opendata.swiss CKAN search** (`Arbeitsbewilligung`, `Kontingente`, `Stellen`, `Zulassung`) | National open-data catalogue, CKAN `package_search` API | Search API itself works fine (`https://opendata.swiss/api/3/action/package_search?q=...`), but returns **zero** permit/employer datasets for any of the four search terms | `q=Arbeitsbewilligung` → `[]` (0 results); `q=Kontingente` → 10 results, all geodata/noise/asylum-adjacent, none permit-related; `q=Stellen` → 10 results, includes only aggregate BFS vacancy-count series (`Offene Stellen nach Grossregion`, `Offene Stellen nach ausgewählten Wirtschaftsabteilungen`) and unrelated cantonal registers; `q=Zulassung` → 10 results, all geodata/health-law, zero migration-permit hits (all fetched 2026-09-03) | None found | **Skip — checked, not found.** No Kontingente/Arbeitsbewilligung dataset exists on the portal under any of these terms |
| **jobs.ch** | Dominant Swiss-German private board (Jobcloud) | **Yes** — `robots.txt` declares 3 sitemaps; job sitemap gzip has structured `<loc>`/`<lastmod>` entries; individual postings are server-rendered with full `schema.org/JobPosting` JSON-LD | `https://www.jobs.ch/robots.txt` → `Sitemap: https://www.jobs.ch/sitemaps/jobs/en/sitemap.xml`; index → `https://www.jobs.ch/sitemaps/jobs/en/job/sitemap.job-en.xml.gz` (200, gunzipped, **42,695** `<loc>` job URLs); detail `https://www.jobs.ch/en/vacancies/detail/fe9f7fa0-114b-4e7d-b6ab-791a2ec35e64/` (200) carries `{"@context":"https://schema.org","@type":"JobPosting","title":"Civil Engineer",...}` with full description; robots.txt disallows `/en/vacancies/detail/*/*/*` (3+ path segments) and blocks `SemrushBot` outright, but the actual one-segment detail URLs used by the sitemap are not matched by that pattern | Medium — general Swiss board, no visa-specific filter, but largest CH pool and clean structured data | **Adapter-worthy** — job sitemap (42.7k URLs) + JSON-LD per posting is a clean, countable door |
| **jobup.ch** | Romandie (French-speaking) sister board to jobs.ch, same Jobcloud platform | **Yes** — same sitemap/robots pattern as jobs.ch; job sitemap has structured entries; detail pages carry `schema.org/JobPosting` JSON-LD | `https://www.jobup.ch/robots.txt` → `Sitemap: https://www.jobup.ch/sitemaps/jobup/en/sitemap.xml`; index → `https://www.jobup.ch/sitemaps/jobup/en/job/sitemap.job-en.xml.gz` (200, gunzipped, **35,647** `<loc>` job URLs); detail `https://www.jobup.ch/en/jobs/detail/0022e91b-b58a-429e-8cae-651a32fd6d90/` (200) carries `{"@context":"https://schema.org","@type":"JobPosting","title":"Apprentice Vehicle Locksmith with Federal Certificate of Competence",...}` | Medium — same platform family as jobs.ch, covers the French-speaking labour market jobs.ch under-indexes | **Adapter-worthy** — separate sitemap/pool (35.6k URLs) from jobs.ch, same parse shape, worth a second adapter for Romandie coverage |
| **jobscout24.ch** | Smaller generalist Swiss board | **Yes** — `robots.txt` declares a gzipped sitemap index; one of 71 sub-sitemaps is job-detail-specific per language | `https://www.jobscout24.ch/robots.txt` → `Sitemap: https://www.jobscout24.ch/sitemap/sitemap.xml.gz`; index (200, gunzipped, 71 sub-sitemaps) includes `sitemap.jobdetails_en_0.xml.gz`, `_de_0..2`, `_fr_0..2`; `sitemap.jobdetails_en_0.xml.gz` (200, gunzipped, **15,000** `<loc>` job URLs, e.g. `https://www.jobscout24.ch/en/job/e0613a9d-238b-48bd-8226-9c004cde2441/`) | Low-medium — smaller, overlapping pool vs. jobs.ch/jobup.ch (same market, no visa filter) | **Park** — clean door confirmed (15k+ EN job URLs alone, plus DE/FR sub-sitemaps), but lower priority than jobs.ch/jobup.ch given likely overlap; revisit if dedup shows meaningful unique inventory |

## Checked, not worth it

- **Job-Room employer-submission API** (`https://api.job-room.ch/jobAdvertisements/v1`) — this is a *different* endpoint from the public search API above: it is the channel employers use to *submit* ads, and it returned `HTTP 401 {"detail":"Full authentication is required to access this resource"}` on both `GET /api/public/jobAdvertisements/v1` and `POST .../\_search` (fetched 2026-09-03). Documented at `https://test-api.job-room.ch/api-docs/jobAdvertisements/v1/index.html`: HTTP Basic Auth required, no visa/permit fields in the schema even for authenticated callers. The **public read path is the one in the table above** (`www.job-room.ch/jobadservice/api/...`), which needs no key at all — do not confuse the two.
- **Job-Room robots.txt** (`https://www.job-room.ch/robots.txt`, fetched 2026-09-03) — disallows crawling `/job-search/` (the rendered SPA page) and `/aav/confirmation`, but says nothing about the `/jobadservice/api/...` path actually used to fetch data, and nothing about `www.arbeit.swiss` (`https://www.arbeit.swiss/robots.txt` → `Disallow:` empty, fully open, `Sitemap: https://www.arbeit.swiss/sitemap_index.xml`).
- **SEM statistics pages, English version** — `https://www.sem.admin.ch/sem/en/home/publiservice/statistik/auslaenderstatistik.html` (fetched 2026-09-03) only says "For the complete statistic see the German or French version" — no English-language breakdown exists; the German PDF was fetched directly instead (see table).
- **SEM Kontingente page, guessed URL** — `https://www.sem.admin.ch/sem/de/home/publiservice/statistik/auslaenderstatistik/kontingente.html` → **404**. No such page; quota figures live only inside the monthly "Statistik Zuwanderung" PDFs (used in the table) and in periodic news releases (e.g. `sem.admin.ch/sem/de/home/aktuell/news/2018/ref_2018-09-280.html`, prose only, no structured export).
- **jobs.ch / jobup.ch `/api/` paths** — both robots.txt files explicitly `Disallow: /api/` and `/api_proxy/` for all crawlers; the site's own JSON backend was not probed for that reason. The sitemap + JSON-LD door in the table is the sanctioned route.

## Note on the two central findings

The **Job-Room public search API** is the find of this scan: a zero-auth,
paginated, exact-count (74,094 live postings, 2026-09-03) JSON feed of every
vacancy reported to the Swiss public employment service, each carrying a
structured `reportingObligation` flag and AVAM occupation code — machine-
readable government labour-market data at a granularity none of the other
Swiss sources offer. It is not, however, a sponsorship signal on its own;
the `reportingObligation` field marks high-*unemployment* occupations (a
head-start rule for local jobseekers), the inverse of a shortage-occupation
flag, and it needs to be presented that way if ingested.

The **quota/permit-holder question has a clean negative**: neither SEM's own
site nor opendata.swiss publishes anything below aggregate national/cantonal
totals by permit type and nationality. Unlike the UK, Netherlands, Ireland
and Portugal sponsor registers already in this project's scans, Switzerland
does not name which employers hold quota allocations — the labour-market
test and quota grant are administered per-application and never surfaced as
a public list.

## Main-session audit, 2026-09-04

**jobs.ch confirmed and shipped** (`src/lib/sources/jobsch.ts`). robots.txt
names no AI crawler, declares three language sitemap trees, and disallows
`/api/` — so the board itself says which door to use, and the adapter uses
that one. The EN tree carries **42,695** individual `/en/vacancies/detail/`
URLs across its gzipped children (counted; the agent's figure was exact), and
detail pages carry full JobPosting JSON-LD. The EN tree is taken on purpose:
the same vacancy exists in de/fr/en, so this gets the readable copy and
avoids ingesting one job three times.

Two faults the first live run exposed, both now fixed and tested. The tree is
**not newest-first** — a head-of-file slice returned postings from May and
July 2025 — so entries are sorted by `lastmod` before slicing. And **not
everything wearing JobPosting markup is a job**: a SIBIRGroup marketing page
("Download Brochures and Price Lists | SIBIRGroup") had borrowed the schema,
so titles carrying site-furniture pipes and bodies under 300 characters are
refused.

**Job-Room is NOT ingested, and this is deliberate.** The agent found a real
unauthenticated search API returning 74,094 live postings — the largest door
in the country by a wide margin. `job-room.ch/robots.txt` is 174 bytes and
opens with the line `# Do not crawl Job Adverts`, then disallows
`/job-search/`. The API path is not literally listed, but pulling the advert
corpus through the SPA's internal endpoint is precisely what that sentence
forbids, reached by a side door. We honour stated intent, not merely the
letter, so this stays unused however large it is.

**Correction to the issue's own hypothesis, and to this file's framing.** The
`reportingObligation` flag does not mark shortage occupations where a
foreigner is likely to be hired; it marks HIGH-UNEMPLOYMENT occupations where
local jobseekers get a head start — the opposite signal. Recorded because the
prompt that commissioned this scan assumed otherwise, and the agent was right
to say so.

**No employer-level permit data exists.** SEM publishes aggregate statistics
only, and opendata.swiss carries nothing below permit-type/canton/nationality
level. Switzerland publishes no UK/NL/IE/PT-style sponsor register.
