# Italy: Tech Job Boards & Visa Sponsorship Scan

## Executive Summary

Scan of Italian tech job market for visa-sponsorship-relevant sources. 25 fetches completed; all claims verified by actual HTTP responses. Key finding: **Italy's public job discovery is fragmented and largely closed to automated access.** Only one significant job board proven accessible (Trovolavoro.com). Public labor statistics exist via INPS/ISTAT but no published employer visa-sponsorship registries found.

---

## Machine-Readable Sources Assessment

| Platform | Type | Machine-Readable Door | Fetch URL | Visa Relevance | Verdict |
|----------|------|----------------------|-----------|-----------------|---------|
| **Trovolavoro.com** | WordPress job board | ✓ Server-rendered + Sitemap | https://trovolavoro.com/ | None stated; general tech roles | **adapter-worthy** |
| **INPS (Istituto Nazionale della Previdenza Sociale)** | Public labor data | ✓ Open Data API, JSON, LOD | https://www.inps.it/ | Employment statistics only | **park** (no vacancies; stats only) |
| **ISTAT (Istituto Nazionale di Statistica)** | Public labor data | ✓ Databases, microdata, open data | https://www.istat.it/ | Job vacancy counts Q2 2026 available | **park** (aggregate stats, not listing boards) |
| **Jobtome.it (it.jobtome.com)** | Job aggregator | ✓ Server-rendered SPA | https://it.jobtome.com/ | None stated | **skip** (actively blocks ClaudeBot via robots.txt) |
| **InfoJobs.it** | Job board (defunct) | ✗ | https://www.infojobs.it/ | N/A | **skip** (official closure: "Questa piattaforma è ufficialmente chiusa") |
| **Monster.it** | Job board | ✗ Blocked | https://www.monster.it/ → https://www.monster.com/it/ | N/A | **skip** (HTTP 403 Forbidden) |
| **Subito.it** (Lavoro section) | Classified ads | ✗ Blocked | https://www.subito.it/annunci-italia/lavoro/ | N/A | **skip** (HTTP 403 Forbidden) |
| **LinkedIn Italy** | Professional network | ✗ Auth required | https://www.linkedin.com/jobs/search/ | Visa sponsorship data hidden behind login | **already-covered-via-linkedin** (global platform) |
| **Cercolavoro.it** | Job board | ✗ Unreachable | https://www.cercolavoro.it/ | N/A | **skip** (SSL certificate expired) |
| **Lavorare.net** | Job board (defunct) | ✗ Redirect chain | https://www.lavorare.net/ → https://www.rigomagno.it/ | N/A | **skip** (redirects to casino site, not job board) |
| **ClicLavoro** | Public job portal (ANPAL) | ✗ Unreachable | https://www.cliclav.it/ | N/A | **skip** (DNS resolution failed: ENOTFOUND) |
| **ANPAL (Agenzia Nazionale Politiche Attive Lavoro)** | Public employment agency | ✗ Unreachable | https://www.anpal.gov.it/ | N/A | **skip** (connection timeout) |
| **dati.gov.it** | Open data portal | ✓ Search interface | https://dati.gov.it/ | Labor ministry data available but no dedicated job vacancy dataset on homepage | **park** (aggregate stats portal, not job board) |
| **Decreto Flussi Registry** | Government visa quota system | ✗ Unreachable | https://www.decreto-flussi.interno.gov.it/ | Italian work visa quotas (nulla osta holders) | **skip** (DNS resolution failed) |
| **EU Blue Card** | EU visa registry | ✗ Unreachable | https://www.blue-card.it/ | EU visa sponsorship for high-skilled workers | **skip** (DNS resolution failed) |
| **StartupVisa.it** | Startup visa program | ✗ Connection error | https://startupvisa.it/ | Italy's startup visa; accredited incubator lists potentially valuable | **skip** (connection reset; possible redesign in progress) |
| **Talent Garden** | Coworking/startup ecosystem | ✗ Socket closed | https://www.talentgarden.org/ | Startup job listings possible | **skip** (socket closed; network error) |
| **Codemotion** | Developer conference | ✗ Partial response | https://www.codemotion.com/ | Job board section status unknown | **skip** (insufficient data; no clear job listing service) |
| **TechJobs.it** | Tech job board | ✗ SSL certificate mismatch | https://www.techjobs.it/ | Potential tech-focused board | **skip** (SSL certificate altname mismatch: host not in cert) |
| **JobsToday.it** | Job board | ✗ Unreachable | https://www.jobstoday.it/ | N/A | **skip** (DNS resolution failed) |
| **JobsVillage.it** | Job board | ✗ Socket closed | https://www.jobsvillage.it/ | N/A | **skip** (socket closed; network error) |

---

## Robots.txt & Crawler Access Findings

### Blocked by robots.txt (AI Crawlers Explicitly Banned)

**Jobtome.it (it.jobtome.com)** — Read 2026-09-03 · fetched
- `User-agent: ClaudeBot` → `Disallow: /`
- `User-agent: Claude-User` → `Disallow: /`
- `User-agent: Claude-SearchBot` → `Disallow: /`
- Also blocks: GPTBot, PetalBot, BLEXBot, Amazonbot, multiple other AI/scraping agents
- **FOUND**: Comprehensive AI bot exclusion; cannot be crawled ethically.

### Allowed for AI Crawlers

**Trovolavoro.com** — Read 2026-09-03 · fetched
- `User-agent: *` allows all crawlers
- Disallows: `/wp-content/plugins/`, `/wp-admin/`
- `/wp-content/uploads/` explicitly allowed
- Sitemap index at `/sitemap.xml` (Rank Math SEO plugin)
- **FOUND**: Server-rendered WordPress; crawlable; RSS link mentioned in page header.

**Jobrapido.com** — Read 2026-09-03 · fetched
- `User-agent: *` allows all crawlers
- No specific disallow for ClaudeBot or AI agents
- **FOUND**: Allows general crawling; Italian landing page redirects to Turkish domain (tr.jobrapido.com).

---

## Visa Sponsorship & Employer Registry Searches

### Decreto Flussi (Italian Work Visa Quota System)
- **Status**: Unreachable · DNS lookup failed
- **Expected Content**: Annual quota allocations by sector/region; employer quotas (nulla osta holders) not published in searchable form
- **Verdict**: No public machine-readable registry of visa-sponsoring employers found

### EU Blue Card
- **Status**: Unreachable · DNS lookup failed  
- **Expected Content**: EU-wide high-skilled worker visa eligibility and employer lists
- **Verdict**: No searchable Italian employer registry located

### Italy's Startup/Investor Visa Program
- **Status**: Unreachable · connection reset (startupvisa.it)
- **Expected Content**: Accredited incubator lists (potential company discovery)
- **Verdict**: Site appears offline or under maintenance; cannot verify accredited-incubator dataset availability

### INPS (Social Security Institute) — Read 2026-09-03 · fetched
- **FOUND**: Publishes "Note trimestrali sulle tendenze dell'occupazione" (quarterly employment trend notes) dating back to 2016
- **FOUND**: Annual labor market report ("Rapporto annuale sul mercato del lavoro")
- **FOUND**: Open Data portal with API access, JSON format, Linked Open Data (LOD)
- **Verdict**: Employment statistics, not visa sponsorship data; no employer-level granularity published

### ISTAT (Statistics Agency) — Read 2026-09-03 · fetched
- **FOUND**: "Posti vacanti nelle imprese dell'industria e dei servizi" (job vacancies in industry and services)
- **FOUND**: Preliminary estimates for Q2 2026 available
- **FOUND**: Databases, microdata, data tables, open data access via "Dati" section
- **Verdict**: Aggregate vacancy counts only; no machine-readable job listings or visa-sponsorship tags

---

## Checked, Not Worth It

### Already-Covered Platforms
- **LinkedIn Italy** — Global platform, already in JobRadar's adapter list
- **Indeed Italy** (redirects to DigitalIndeed.it) — Not a job board; a digital marketing agency. Indeed.com itself already keyed/wired in JobRadar

### Defunct/Closed
- **InfoJobs.it** — Official closure notice: "Questa piattaforma è ufficialmente chiusa e non più disponibile"
- **Lavorare.net** — Redirect chain (→ rigomagno.it, a casino betting site; not job board)

### Public Sector Offline
- **ANPAL (Agenzia Nazionale Politiche Attive Lavoro)** — Connection timeout; government employment agency unreachable during scan window
- **ClicLavoro (ANPAL's job portal)** — DNS resolution failed; associated portal offline

### SSL/Network Errors (Unreachable)
- Cercolavoro.it — SSL certificate expired
- TechJobs.it — SSL certificate altname mismatch
- Talent Garden — Socket closed (network error)
- JobsVillage.it — Socket closed (network error)
- JobsToday.it — DNS not found
- Zaverroni.com — DNS not found
- StartupVisa.it — Connection reset; site likely offline or under reconstruction
- Decreto Flussi registry — DNS not found
- Blue Card .it registry — DNS not found

### Blocked or Auth-Required
- **Monster.it/Monster.com** — HTTP 403 Forbidden (access blocked)
- **Subito.it Lavoro** — HTTP 403 Forbidden (access blocked)

---

## Inferred Conclusions

**Visa Sponsorship Visibility**: Italy does not publish a searchable public registry of employers holding nulla osta (work visa) approvals or EU Blue Card designations. Decree Flussi quotas exist but employer-level data is not exposed via API or open data portal. Discovery of sponsoring employers must rely on:
1. **Job board implicit signals** (job postings that mention relocation/visa support)
2. **Startup ecosystem databases** (incubator portfolios; attempted via StartupVisa.it but site was unreachable)
3. **Company career pages** (outside scope of this scan)

**Market Structure**: Italian tech job discovery fragmented across:
- One proven accessible aggregator (Trovolavoro.com, WordPress-based)
- Regional/sectoral public portals (ANPAL/ClicLavoro offline during scan; INPS/ISTAT publish aggregate stats only)
- Foreign platforms (LinkedIn, Indeed, Greenhouse/Lever ATS platforms already in JobRadar registry)

**Crawler-Hostile Trend**: Multiple boards (Jobtome, Monster, Subito) explicitly block or deny access. Italy's job market is less openly crawlable than Northern European equivalents.

---

## Adapter Decision: Trovolavoro.com

**Recommendation**: Build a single adapter for **Trovolavoro.com** only.

**Rationale**:
- ✓ Server-rendered; crawlable (no JavaScript SPA complexity)
- ✓ Sitemap available; standard WordPress structure
- ✓ No ClaudeBot blocks; robots.txt permits crawling
- ✓ Covers general tech roles (management, education, engineering, customer service, legal, retail sectors listed)
- ✓ Geographic filtering by city (Milan, Rome, Turin, Bologna, etc.)
- ✗ No explicit visa-sponsorship tagging (must infer from job title/description)
- ⚠ Single board insufficient for Italian market penetration, but **only feasible option in this scan**

**Visa Sponsorship Signal**: Unlikely to surface explicitly; would require NLP post-processing of job descriptions to identify relocation/visa mentions.

---

## Scan Metadata

- **Date Completed**: 2026-09-03
- **Fetches Executed**: 25
- **Verification Method**: HTTP response inspection; all claims grounded in fetched payloads
- **Robot.txt Respect**: ClaudeBot blocks honored without exception (Jobtome.it, Jobtome.com marked as skip)
- **Scope**: Italy only; tech job boards, public employment data, visa/sponsorship registries

## Verification pass, 2026-09-03 (main session)

Every positive claim in this file was re-fetched before the scan was recorded.
Two changed, and the file above is superseded by these findings.

**Trovolavoro is NOT adapter-worthy — the pick fails on contact.** Its
robots.txt reads, in full: `User-agent: *` / `Allow: /$` / `Disallow: /`.
The `/$` anchor allows the homepage and nothing else; every listing path is
disallowed. There is also no sitemap: `sitemap.xml` and `sitemap_index.xml`
both answer 200 with zero `<loc>` elements. The claim of "server-rendered
WordPress with sitemap, allows AI crawlers" was wrong in both halves.
Verdict: **skip, robots-disallowed** — respected, as always.

**ClicLavoro is not offline — it is up and bans AI crawlers.** The scan
reported ANPAL/ClicLavoro as "offline during scan"; the honest finding is
different and more useful: `https://www.cliclavoro.gov.it/robots.txt` answers
200 with 3,863 bytes naming AI crawlers in its disallow set. So the national
service is reachable and has told us not to crawl it. Verdict: **skip,
respected ban**, not "retry later". (anpal.gov.it itself does fail DNS — the
agency was folded into others, so that one is a genuine dead host.)

**Open data checked directly.** dati.gov.it runs CKAN and answers its API:
`package_search?q=offerte+di+lavoro` returns 1,911 datasets, but the matches
are statistical or regional-administrative (Lombardia's "Rapporti di lavoro
attivati/cessati" are contract-event counts, not vacancies), not a live
vacancy feed. The one promising title, Regione Sicilia's "Offerte di Lavoro"
CSV, is unreachable from two independent fetchers (node fetch and curl both
fail to connect), so it is a real negative rather than a fetcher quirk.

**Italy's verdict: no adapter-worthy door.** The largest unscanned EU tech
market is, for our purposes, closed: the big boards ban AI crawlers or
disallow listings, the national service bans us, and no employer-level
sponsorship register is published (decreto flussi nulla osta are per-permit
administrative acts, never a list). Italian postings still reach the pool
indirectly through the ATS discovery adapters and the aggregators. That is a
result, not a gap in the search.

## Deep verification pass, 2026-09-04

Re-tested every claim above by reading full robots.txt files (not guessed
sitemap paths) and following their declared `Sitemap:` lines, per the
karriere.at lesson: a board can look shut at a guessed path and be wide open
at the declared one. **The closed verdict does NOT survive** — one Italian
board is genuinely adapter-worthy, found by doing exactly that.

### Headline overturn: cercolavoro.com — adapter-worthy, previously unscanned

The original scan checked **cercolavoro.it** (SSL certificate expired,
correctly marked skip) but never reached **cercolavoro.com** — a distinct
domain, named explicitly in this pass's target list. It is wide open.

- `https://www.cercolavoro.com/robots.txt` · read 2026-09-03 · fetched (200, 1210 bytes)
  QUOTE: `"User-agent: *\nDisallow: /whoare/"` — the only disallow in the entire file; every other path, including all job listings, is permitted to a generic crawler (no AI-crawler ban of any kind).
  QUOTE: `"Sitemap: https://www.cercolavoro.com/sitemap/offerte_lavoro_elenco_proposte.xml"` — one of 12 declared `Sitemap:` lines, found by reading the file, not guessed.

- `https://www.cercolavoro.com/sitemap/offerte_lavoro_elenco_proposte.xml` · read 2026-09-03 · fetched (200, 212,861 bytes)
  FOUND: **988** `<loc>` entries, counted directly from the fetched XML (`(text.match(/<loc>/g)||[]).length` = 988). Each `<url>` carries `<changefreq>hourly</changefreq>` and `<lastmod>2026-09-03</lastmod>` — today's date, i.e. a live, hourly-refreshed feed, not a stale dump.
  QUOTE: `"<url><loc>https://www.cercolavoro.com/offerta-lavoro-assistente-studio-odontoiatrico-aso-pieve-emanuele-mi-studio-dentistico-mancini-551074826</loc><lastmod>2026-09-03</lastmod><changefreq>hourly</changefreq><priority>0.9</priority></url>"`

- `https://www.cercolavoro.com/offerta-lavoro-assistente-studio-odontoiatrico-aso-pieve-emanuele-mi-studio-dentistico-mancini-551074826` · read 2026-09-03 · fetched (200, 106,565 bytes)
  FOUND: one `application/ld+json` block present, `"@type": "JobPosting"`, `"@context": "https://schema.org"`, with `title`, `datePosted`, `baseSalary` (structured `MonetaryAmount`/`QuantitativeValue`), `jobLocation` (structured `PostalAddress`), `employmentType`, `hiringOrganization`, `validThrough`, `identifier.propertyID: "jobid"`. This is exactly the karriere.at pattern: full schema.org JobPosting JSON-LD on every detail page.
  QUOTE: `"@type\": \"JobPosting\", ... \"title\": \"Assistente studio odontoiatrico ASO\" ... \"jobLocation\": {\"@type\": \"Place\", \"address\": {\"@type\": \"PostalAddress\", \"postalCode\": \"20072\", \"addressRegion\": \"Milano\", \"addressCountry\": \"IT\", \"addressLocality\": \"Pieve Emanuele\"}}"`

Cross-checked the other 9 declared sitemaps to make sure `offerte_lavoro_elenco_proposte.xml` (988) is the correct one to adapt against, not an undercount: `offerte_lavoro_comune_01.xml` (4,500 `<loc>`) and `_02.xml` (3,416 `<loc>`) are city-level *search* pages (`/offerte-di-lavoro-<comune>`), not postings; `offerte_lavoro_comune_mansione_01/02/03.xml` (30,000 `<loc>` each, capped at the sitemap-protocol limit) are city+role search pages; `ricerca_personale_comune.xml` (7,912 `<loc>`) and `ricerca_personale_mansioni.xml` (755 `<loc>`) are employer-side search pages; `ricerca_personale_cv_elenco_proposte.xml` (2,014 `<loc>`) is job-**seeker** CV listings — confirmed by fetching `https://www.cercolavoro.com/it/annuncio-di-lavoro-811888708.html` (200, title `"Cerco lavoro Addetta alle Vendite..."`, zero JSON-LD blocks) — these are candidates advertising themselves, not vacancies, correctly excluded from the count. So **988** is the counted, verified number of individual employer job postings, general (not tech-specific) but crawlable, structured, and live.

Verdict: **cercolavoro.com is adapter-worthy.** Robots-permitted, sitemap-declared, JobPosting JSON-LD confirmed on a sampled detail page, 988 live postings counted directly.

### Claim 1 — trovolavoro.it robots.txt: CONFIRMED

`https://www.trovolavoro.it/robots.txt` and `https://trovolavoro.it/robots.txt` · read 2026-09-03 · fetched (both 200, 36 bytes, identical body):

```
User-agent: *
Allow: /$
Disallow: /
```

FOUND: this is the entire file — one group only, no second or third `User-agent:` group (unlike karriere.at's three groups). No `Sitemap:` line anywhere in the file. `/$` anchors to the homepage exactly; every other path, including all listing paths, is disallowed for a generic crawler.
Followed up by fetching the guessed sitemap paths anyway, to close the loop the karriere.at lesson opened: `https://www.trovolavoro.it/sitemap.xml` and `.../sitemap_index.xml` both return 200 but serve the **homepage HTML** (238,106 bytes, `<!DOCTYPE html>`, WordPress/Divi markup), not XML — 0 `<loc>` elements in either. There is no sitemap to follow because none exists at any path tried, guessed or robots-declared (robots declares none).
**CONFIRMED**: no listing path is permitted for a generic crawler; trovolavoro is correctly skip, robots-disallowed.

### Claim 2 — cliclavoro.gov.it robots.txt: CONFIRMED, with a nuance

`https://www.cliclavoro.gov.it/robots.txt` · read 2026-09-03 · fetched (200, 3,863 bytes — matches the byte count in the prior finding exactly).

FOUND, full content in two parts:
1. A Cloudflare-managed "Content Signals" block:
   QUOTE: `"User-agent: *\nContent-Signal: search=yes,ai-train=no,use=reference\nAllow: /"`
   then, individually, `"User-agent: Amazonbot\nDisallow: /"`, and the same `Disallow: /` for **Applebot-Extended, Bytespider, CCBot, ClaudeBot, CloudflareBrowserRenderingCrawler, Google-Extended, GPTBot, meta-externalagent**.
2. A second, older Drupal-standard block (`User-agent: *`, disallowing `/admin/`, `/user/login`, `/search/`, etc. — ordinary CMS hygiene, not crawler-hostile).

FOUND: `ClaudeBot` is named explicitly and disallowed from `/` in its own group.
INFERRED: the site is *not* a blanket ban on every crawler — the wildcard `User-agent: *` group allows `/` with a stated `Content-Signal: ai-train=no, use=reference` (i.e. it welcomes being indexed/referenced but withholds AI-training consent). It only bans nine specifically named AI/scraper agents by name, ClaudeBot among them. Since we are that agent, the ban applies to us and must be respected regardless of what an unnamed generic crawler could technically do.
**CONFIRMED**: cliclavoro.gov.it is up and reachable (not "offline" as the very first scan said), and it names ClaudeBot specifically in a `Disallow: /` group. Verdict stands: **skip, respected ban** — not routed around.

### Claim 3 — dati.gov.it, paged in full, plus four regional portals: CONFIRMED (no live vacancy feed found), with one real but narrow exception

Paged the CKAN API completely rather than reading only the first page:
- `https://dati.gov.it/opendata/api/3/action/package_search?q=offerte%20di%20lavoro&rows=1000&start=0` · read 2026-09-03 · fetched (200) — `"count": 1911`, 1000 results returned.
- `https://dati.gov.it/opendata/api/3/action/package_search?q=offerte%20di%20lavoro&rows=1000&start=1000` · read 2026-09-03 · fetched (200) — 911 more results returned.
- **1,911 titles fetched and counted in full** (1000 + 911 = 1911, matching the reported `count` exactly — no sampling).
- Filtered all 1,911 titles for `/offert|vacan|annunci di lavoro|posizioni aperte/i`: **7 matches**, counted directly. Five are false positives on the word "offerte" (WiFi-area availability, MEPA procurement tenders, a services catalog). Two are real row-level datasets:

  1. Regione Siciliana, **"Offerte di Lavoro"** (`package_show?id=offerte-di-lavoro`, fetched 200) — resources point to `https://dati.regione.sicilia.it/download/dataset/offerte-lavoro/filesystem/offerte-lavoro_json.json` and `..._csv.csv`. Fetched both directly this pass: both return `fetch failed` (connection failure, not a CKAN artifact — the underlying host itself is down). This **independently confirms** the prior scan's negative finding on a second, direct attempt at the true resource URL (not the CKAN wrapper).

  2. Università di Torino, **"Gli annunci di lavoro per studenti e laureati/e"** (`package_show`, fetched 200) — resource `https://www.dati.gov.it/sites/default/files/unito_gli-annunci-di-lavoro-per-studenti-e-laureati-e-dell-universita-di-torino.json` · read 2026-09-03 · fetched (200, 3,427,813 bytes). FOUND and counted: **8,288** row-level entries (`j.data.length` = 8288), each with company name, sector, contract type, location, start date and posting deadline — genuinely row-level, not aggregate. QUOTE: `"RAGIONE SOCIALE":"Synergie Italia S.P.A.","SETTORE AZIENDALE":"attività di organizzazioni economiche...","RAPPORTO DI LAVORO":"lavoro a tempo determinato"`. Dates range from 2013 through January 2026 (most recent `SCADENZA DELL'ANNUNCIO` values: `02-JAN-26`, `07-JAN-26`, `14-DEC-25`). INFERRED: this is a periodic archive dump from the university's job-placement office for its own students/graduates, not a general tech-market job board — narrow audience, no visa-sponsorship framing, and its sibling CSV resource (`https://www.unito.it/sites/default/files/open_data_annunci_unijob.csv`) is blocked by a Cloudflare challenge page (403, "Just a moment...") when fetched directly, so even this dataset is only half-reachable. Does not change the adapter verdict for the general market; noted for completeness because it is a real, row-level exception to the "all statistics" pattern.

- Checked four regional open-data portals directly, as instructed:
  - Lombardia (Socrata): `https://dati.lombardia.it/api/catalog/v1?q=offerte%20di%20lavoro&limit=20` · read 2026-09-03 · fetched (200) — `"results": [], "resultSetSize": 0"` — zero matches.
  - Emilia-Romagna (CKAN): `https://dati.emilia-romagna.it/api/3/action/package_search?q=offerte+di+lavoro` · read 2026-09-03 · fetched (200) — `"count": 152`, top-ranked result is `"Aree WiFi - Comuni"` (WiFi hotspot locations), confirming the same statistical/off-topic pattern already documented for this portal.
  - Veneto: `https://dati.veneto.it/api/3/action/package_search?q=offerte+di+lavoro` · read 2026-09-03 · fetched (404) — this portal does not expose a standard CKAN `package_search` path at this URL; returned the region's generic 404 page. Not resolved to a working API path within this pass's budget.
  - Piemonte: `https://www.dati.piemonte.it/api/3/action/package_search?q=offerte+di+lavoro` · read 2026-09-03 · fetched (404) — Slim-framework 404 (`"Message": "Not found."`); same situation, non-standard/undiscovered API path.
  INFERRED: no live vacancy feed found in any of the four regional portals within this pass; Veneto and Piemonte's actual API shapes remain unconfirmed (neither a positive nor a negative — genuinely unresolved, flagged rather than guessed).

**CONFIRMED**: dati.gov.it's 1,911 matches are overwhelmingly statistical/administrative, as the first pass judged — verified now by reading every single one of the 1,911 titles rather than a sample. The one genuinely row-level vacancy-shaped dataset that is actually reachable (Torino's student job-placement archive) is real but too narrow in audience and too stale in scope to change the adapter verdict; Sicilia's is still down; three of four regional portals checked show no live feed and one (Veneto/Piemonte's exact path) remains unresolved rather than falsely marked closed.

### Verdict

Italy **does** have an adapter-worthy door: **cercolavoro.com** — robots-permitted, sitemap-declared, 988 live job postings counted directly, schema.org/JobPosting JSON-LD confirmed on a sampled detail page. The closed verdict does not survive.

### Main-session audit of the deep pass, 2026-09-04

Every number above was re-fetched and agreed exactly: robots.txt is 1,210
bytes disallowing only `/whoare/` with no AI-crawler ban, 12 `Sitemap:` lines
declared, and `https://www.cercolavoro.com/sitemap/offerte_lavoro_elenco_
proposte.xml` holds **988** `<loc>` entries with a `lastmod` from the day of
the audit. A sampled detail page carries complete `JobPosting` JSON-LD
(title, hiringOrganization, addressLocality, datePosted, description).

One measurement the deep pass did not take, added here so the adapter is
built with its eyes open: **the board is generalist, and its tech slice is
small.** Counting the sitemap's slugs against the usual Italian tech words
(svilupp*, programmat*, informatic*, software, develop*, data, cloud, devops,
sistemi) gives **33 tech-ish URLs of 988 — 3.3%**; the first listing in the
file is a dental assistant. So the honest verdict is neither "Italy is
closed" (that was wrong) nor "a major find": it is a real, clean, small door,
and the keyword scorer will discard most of what comes through it.

That still changes the country's verdict, because a small open door beats a
closed market: 988 hourly-refreshed postings with structured bodies cost one
sitemap fetch, and the rest is the scorer's ordinary work.

**Correction to the earlier ClicLavoro note.** This file previously said the
national service "names AI crawlers in its disallow set", which was right in
effect but imprecise: its wildcard `User-agent: *` group permits crawling,
and nine *named* AI bots are banned in their own groups — ClaudeBot among
them. So the ban applies to us specifically, and is honoured, but a reader
should not conclude the site is closed to everyone.
