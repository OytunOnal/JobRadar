# Source scan: Germany

Scope: Germany only, tech roles, visa-sponsorship bias. Primary sources only —
every row below names a URL that was actually fetched. Marketing copy and
third-party "best job boards" listicles were not accepted as evidence.

Already covered and therefore out of scope: arbeitsagentur, germantechjobs,
berlinstartupjobs, greenjobsde, eures, arbeitnow, remotive, remoteok, jobicy,
himalayas, weworkremotely, freehire, workingnomads, thehub, themuse, adzuna,
jsearch/indeed, linkedin, and the 30 ATS platforms that already have discovery
adapters.

Scanned 2026-09-02.

## Findings

| Board | Type | Machine door? | Verified URL | Visa relevance | Verdict |
| --- | --- | --- | --- | --- | --- |
| **EnglishJobs.de** | English-language German job board | **Yes** — server-rendered listing HTML, `?page=N` pagination, title/company/location inline | `https://englishjobs.de/jobs/visa_sponsorship` (200, states "209 visa sponsorship English-speaking jobs in Germany"; Berlin 45, Munich 28, Frankfurt 26) · `https://englishjobs.de/robots.txt` (200) · `https://englishjobs.de/sitemap.xml` (200, index of 47 category sitemaps) | **Highest** — a first-class `visa_sponsorship` facet, and the whole board is English-only postings in Germany by construction | **adapter-worthy** |
| **IT-Treff** | German IT job board | **Yes** — RSS 2.0 with schema.org JobPosting fields | `https://www.it-treff.de/jobs-rss.xml` (200, ~100 items, each carrying `schema:jobLocation`, `schema:hiringOrganization`, employment type, publication + expiry dates, some `schema:baseSalary`; detail URLs `https://www.it-treff.de/it-job-stellenangebot/{slug}-{id}`) · `https://www.it-treff.de/robots.txt` (200) | Low — inventory is German-language SAP/enterprise IT (e.g. "SAP-Anwendungsbetreuer (m/w/d) … Stadtwerke Saarbrücken Netz AG") | **adapter-worthy** (cleanest door in Germany; value is tech volume, not visa) |
| **JobGlance** | Visa-sponsorship aggregator | **Partial** — `robots.txt` is `Allow: /` with two sitemaps, but `sitemap-jobs.xml` holds only 32 *category* URLs, not postings; the Germany page itself is SSR with ~30 jobs and a "see all" link | `https://jobglance.app/robots.txt` (200) · `https://jobglance.app/sitemap-jobs.xml` (200, 32 entries) · `https://jobglance.app/jobs/visa-sponsorship/germany/` (200, states **892 visa-sponsored roles**; HelloFresh, N26, GetYourGuide, Snowflake; detail URLs `https://my.jobglance.app/job/{title}-{company}-{id}`) | **Highest** — the entire axis of the site is visa sponsorship, and 892 German roles is the largest sponsor-filtered German pool found | **adapter-worthy** (needs pagination discovery on `my.jobglance.app`; the public sitemap will not enumerate postings) |
| **WeAreDevelopers** | Developer-community job board | **Partial** — permissive robots + sitemap index; `job-categories.xml` gives 1,090 crawlable facet pages (`/jobs/l/…`, `/jobs/s/…`, `/jobs/ls/…`) at `changefreq: daily`, but there is no per-posting sitemap | `https://www.wearedevelopers.com/robots.txt` (200; note `Content-Signal: search=yes, ai-input=yes, ai-train=no`) · `https://www.wearedevelopers.com/sitemap.xml` (200, 6 children) · `https://www.wearedevelopers.com/sitemaps/job-categories.xml` (200, 1,090 URLs) | Medium — Berlin-headquartered, English-language dev roles, but no explicit sponsorship flag was observed | **park** — reachable, but costs a facet-crawl to enumerate; revisit if English-Berlin volume is short |
| **Get in IT** | German IT graduate/entry board | **Yes** — sitemap enumerates individual postings `/jobsuche/p{id}`; robots blocks only `/jobsuche/feeds/` | `https://www.get-in-it.de/robots.txt` (200) · `https://www.get-in-it.de/sitemap.xml` (200, individual job URLs from `p759` to `p79752`, `lastmod` Aug 14 – Sep 1 2026) | Low — German-language, aimed at German university graduates; sponsorship is not a facet | **park** |
| **Workeer** | Board for international and refugee talent in Germany | Door open, inventory unverified — `robots.txt` is `User-agent: * / Disallow:` (fully permissive), no sitemap declared | `https://workeer.de/robots.txt` (200) | Nominally high (international talent), but tech-role density was not measured | **park** — cheap to probe later; not verified enough to build against |
| **Next Level Jobs EU** | Sponsor-curated EU board | Yes — SSR, and the EU-wide sitemap is already recorded in the France section (`https://nextleveljobs.eu/jobs/sitemap.xml`, ~1,100 sponsor-curated jobs) | `https://nextleveljobs.eu/jobs?country=germany` (200, SSR; Germany facets exist — "Backend Jobs in Germany", "Fullstack Jobs in Germany" — but **no Germany-specific count is published**; sample listings are US-anchored, e.g. Netflix, Reddit) | High by construction, but the German slice is unquantified | **already-covered-via-nextleveljobs** — no separate Germany adapter; the EU-wide sitemap already sweeps German rows |
| **StepStone** | Largest German private board | **No** — hard bot wall | `https://www.stepstone.de/robots.txt` → **HTTP 403** · `https://www.stepstone.de/sitemap.xml` → **HTTP 403** | Would be high (volume), unreachable | **skip** |
| **Xing Jobs** | German professional network | **No** — not fetchable at all; job detail sits behind login | `https://www.xing.com/robots.txt` → fetch refused by the client ("unable to fetch from www.xing.com") | n/a | **skip** |
| **Honeypot** | Curated German dev marketplace | **No** — no HTTPS service | `https://www.honeypot.io/` → `ECONNREFUSED 109.233.159.206:443` (DNS resolves, port 443 refuses) | n/a — appears defunct | **skip** |
| **Instaffo** | Reverse-recruiting matching platform | **No postings behind the door** — robots is permissive and the sitemap is real, but it contains 412 URLs of which **zero** are job postings (7 `/startup-jobs/{city}` landing pages, 39 `/berufsbilder/` role descriptions, the rest content marketing) | `https://www.instaffo.com/robots.txt` (200) · `https://www.instaffo.com/sitemap.xml` (200, 412 URLs) | n/a — matching happens after candidate signup, so there is no public pool to ingest | **skip** |
| **Germany Is Calling** | Visa-sponsorship curated board | **No** — anti-bot wall | `https://germanyiscalling.com/` → **HTTP 403** · `https://germanyiscalling.com/sitemap.xml` → **HTTP 404** (`/robots.txt` returned only a Content-Signal boilerplate page, no crawlable directives) | Would be high (its whole premise is visa-sponsored German roles), unreachable | **skip** |
| **Make it in Germany** (official) | Federal government portal | **No** — Radware bot challenge on every path tried | `https://www.make-it-in-germany.com/en/looking-for-foreign-professionals/jobs-in-germany` → Radware "Verifying your browser" interstitial · `https://www.make-it-in-germany.com/en/working-in-germany/job-listings` → same interstitial (incident `6fef3f85-dy0y-489c-9632-fe4a53340645`) | Would be the single most on-topic official source | **skip** — see the note below on why this costs us nothing |
| **Relocate.me** | Relocation/visa job board | Door open but the shelf is bare — robots permissive, but the single `sitemap.xml` carries only ~40 job postings *across all countries*, and the Germany view reports zero | `https://relocate.me/robots.txt` (200) · `https://relocate.me/sitemap.xml` (200, ~40 postings, pattern `/{country}/{city}/{company}/{title}-{id}`) · `https://relocate.me/international-jobs/germany` (200, states **"0 jobs available"**) | High in principle, empty in practice | **skip** |

## Answers to the three questions

**1. Biggest tech-relevant private boards.** The two largest — StepStone and Xing
— are both closed: StepStone returns 403 on its own `robots.txt`, which means
there is no polite door to knock on, and Xing could not be fetched at all.
Honeypot is gone (connection refused on 443). Instaffo is a matching platform
with no public pool. What is actually open is the second tier: **IT-Treff**
publishes a schema.org-annotated RSS feed, **Get in IT** enumerates individual
postings in its sitemap, and **WeAreDevelopers** exposes 1,090 daily-refreshed
facet pages. Jobglance was reached at `jobglance.app`, not the `.com` the earlier
run had tried, which is why that lead had stalled.

**2. Public/official sources beyond arbeitsagentur.** Nothing usable was found.
Make it in Germany is the obvious candidate and it sits behind a Radware
challenge on every job path. This is a small loss rather than a large one: Make
it in Germany is a federal portal layered over the Bundesagentur für Arbeit
Jobbörse rather than an independent inventory, so its postings would very likely
be duplicates of rows the arbeitsagentur adapter already ingests. That backing
relationship could not be confirmed from the primary source, because the primary
source is exactly what the bot wall hides — it is stated here as the reason the
skip is cheap, not as a verified fact.

**3. Visa/relocation-focused boards — the highest-value question.** Three real
doors, one dead end, one wall:

- **EnglishJobs.de** is the best of them. It is German-only inventory, English-only
  postings, and it ships a `visa_sponsorship` facet as a first-class URL. The
  count on that page read **209** at fetch time, against **136** reported by the
  search index shortly before, so the pool is live and moving.
- **JobGlance** claims the largest sponsor-filtered German pool at **892 roles**,
  with recognizable employers (HelloFresh, N26, GetYourGuide, Snowflake). It costs
  more to build against, because the published sitemap enumerates categories
  rather than postings.
- **Workeer** has a fully open door but unmeasured tech density.
- **Relocate.me** is open and effectively empty — 0 German jobs.
- **Germany Is Calling** is the one genuine loss: right premise, 403 on the root
  and no sitemap.

### A caveat on EnglishJobs.de worth carrying into implementation

Its `robots.txt` disallows `/clickout/*`, `/subredirect/*` and `/clickout_alt/*`
— and every job link on the listing page is a `/clickout/{id}?ql=…` redirect. The
listing pages themselves are not disallowed, and they already carry title,
company, location and date inline, so an adapter can take everything it needs
from the listing HTML and store the clickout URL as the apply link without ever
crawling it. That respects the file as written. It does mean there is no
crawlable canonical detail page, so full job descriptions would have to come from
the `{id}` acting as a stable key, not from a second fetch.

## Checked, not worth it

- **StepStone** — 403 on `robots.txt` and `sitemap.xml`. No door.
- **Xing** — client-level fetch refusal; postings are behind login regardless.
- **Honeypot** — `ECONNREFUSED` on port 443. Site appears defunct.
- **Instaffo** — sitemap verified at 412 URLs with zero job postings among them.
  Reverse-recruiting by design, so there is nothing to ingest.
- **Germany Is Calling** — 403 on root, 404 on `sitemap.xml`.
- **Make it in Germany** — Radware challenge on both job paths; almost certainly
  a re-skin of arbeitsagentur inventory we already hold.
- **Relocate.me** — open robots, ~40 postings worldwide, "0 jobs available" for
  Germany.
- **Next Level Jobs EU** — reachable and relevant, but the EU-wide sitemap already
  logged in the France section covers the German rows. No second adapter.
- **Get in IT** — mechanically easy (individual postings in the sitemap) but the
  inventory is German-language graduate roles with no sponsorship signal. Parked
  rather than dismissed.
