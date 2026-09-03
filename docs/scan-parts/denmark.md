# Source scan: Denmark

Scope: Denmark only, tech roles, visa-sponsorship bias. Primary sources only —
every row below names a URL that was actually fetched. Marketing copy and
third-party "best job boards" listicles were not accepted as evidence. Where a
`WebFetch` was refused, the URL was retried from Node with a desktop-Chrome
User-Agent before the site was declared closed.

Already covered and therefore out of scope: `denmark` (Jobnet BFF API),
`jobindexdk` (RSS per query), thehub, eures, arbeitnow, remotive, remoteok,
jobicy, himalayas, weworkremotely, freehire, workingnomads, themuse, adzuna,
jsearch/indeed, linkedin, and the ~30 ATS platforms that already have discovery
adapters. Denmark's SIRI fast-track certified-companies register is already
parsed into `VisaSponsor` (`src/lib/visa/sponsors.ts`), so the question here was
only whether anything **adds** to it.

Scanned 2026-09-03.

**Headline: one clear win and one clean kill.** IT-Jobbank — Denmark's
tech-only board — turns out to run the same Jobindex (`window.JIX`) stack we
already ingest, and hands us both an RSS door and schema.org `JobPosting`
JSON-LD. Ofir bans all crawling outright, and Jobfinder (now techjob.dk) bans
ClaudeBot by name.

## Findings

| Board / source | Type | Machine door? | Verified URL | Visa relevance | Verdict |
| --- | --- | --- | --- | --- | --- |
| **IT-Jobbank.dk** (Computerworld it-jobbank) | **Denmark's tech-only board**, Jobindex family | **Yes — two doors, both keyless.** `https://www.it-jobbank.dk/robots.txt` (200, 1,889 bytes) disallows `/api/`, `/job/*?` and a long list of `/jobsoegning*` query params (`page=`, `sort=`, `jobage=`, `companyid=`, `radius=`, …) — but **`/jobannonce/` is not disallowed**, `?format=rss` is not in the list, and the file declares `sitemap: https://www.it-jobbank.dk/sitemap.gz`. **No AI-crawler ban** (the only named agents are `008`, `sogou spider`, `CariBot`). **(a) Sitemap → JSON-LD.** `https://www.it-jobbank.dk/sitemap.gz` (200, `application/x-gzip`, 267 bytes) is an index of three: `googleforjobs.gz`, `content.gz`, `area.gz`. `https://www.it-jobbank.dk/sitemap/googleforjobs.gz` (200, 5,242 gz → 32,853 XML) holds **150 job URLs, every one with a `<lastmod>`, newest `2026-09-02T12:17Z`**. A sampled detail page `https://www.it-jobbank.dk/jobannonce/h1691577/customer-supporter` (200, 106,767 bytes) carries **two `application/ld+json` blocks, one a full `JobPosting`**: `datePosted, description, employmentType, hiringOrganization, identifier, jobLocation, title, validThrough` (sample row: KMD, `datePosted 2026-08-21`). `content.gz` (617 editorial URLs) and `area.gz` (**759** `/jobsoegning/{place}` facet pages) are the other two. **(b) RSS.** `https://www.it-jobbank.dk/jobsoegning?format=rss` → **200 `application/rss+xml`, 66,246 bytes, 25 `<item>`s** with `<title>`, `<link>` (`/vis-job/h1695099`) and an HTML `<description>`. Query filtering works: `?q=software+engineer&format=rss` (200, 65,681 bytes) returns a **different** 25 (top row: *Platform Engineer (AI-First), Bloom*). Path-based area filtering does **not** — `/jobsoegning/storkoebenhavn?format=rss` returned byte-identical results to the unfiltered feed | Indirect but strong: it is 100% tech, in Denmark, and joins cleanly against the SIRI names we already hold | **adapter-worthy — top DK pick.** The page markup identifies the stack as `window.JIX` (Jobindex), so this is a **near-clone of the existing `jobindexdk` adapter** repointed at a tech-only domain, with a JSON-LD detail door the existing one does not use. Cheapest new inventory in this scan |
| **Ofir.dk** | Large Danish generalist board | **No — a total crawl ban.** `https://www.ofir.dk/robots.txt` (200, 47 bytes) is, in full: `User-agent: *` / `Allow: /.well-known/` / **`Disallow: /`** | n/a | **skip — robots ban, respected.** Nothing further was fetched from the host |
| **Jobfinder.dk → techjob.dk** | Tech/engineering board (rebranded) | **No — an explicit AI-crawler ban.** `https://www.jobfinder.dk/robots.txt` **302s to `https://techjob.dk/robots.txt`** (200, 2,968 bytes, Drupal). Under a header reading `# Disallow AI Crawlers - From the list https://github.com/ai-robots-txt/ai.robots.txt`, the file names **`ClaudeBot`, `Claude-Web`, `anthropic-ai`**, alongside `GPTBot`, `CCBot`, `PerplexityBot`, `Bytespider`, `Google-Extended`, `Meta-ExternalAgent`, `OAI-SearchBot` and ~30 more; a further block dated `# Added 2025-08-08: AI-specific controls` extends it | Would be moderate (tech-heavy) | **skip — AI-crawler ban, respected.** Recorded as a finding, not worked around. Note the rebrand: Jobfinder.dk is now techjob.dk |
| **Graduateland** | Nordic graduate board | **No — it no longer exists as itself.** `https://graduateland.com/robots.txt` **302s to `https://www.jobteaser.com/robots.txt`** (200, 763 bytes). Graduateland has been absorbed into JobTeaser. JobTeaser's index is open — `https://assets-cf.jobteaser.com/sitemaps/sitemap.xml` (200) fans out to five `job_ads_sitemap*.xml` holding **24,705 job URLs**, `lastmod 2026-09-03T00:20` — but the content behind it is walled: a sampled job URL returns **HTTP 403 "JobTeaser \| Security checkup"** in both `/en/` and `/de/` form with full desktop-Chrome headers, and `https://www.jobteaser.com/en/job-search` → **404** | Low — internship and graduate skew | **skip** — open index, locked room, wrong seniority band |
| **Workindenmark.dk** | The national public employment service **for international candidates** (STAR) | **Yes, and it is a skin over what we already ingest.** `https://www.workindenmark.dk/robots.txt` → **404, zero bytes** (no robots file). `https://www.workindenmark.dk/` (200, 49,698 bytes) links its job search to **`https://workindenmark.jobnet.dk/`**, which 302s to `https://workindenmark.jobnet.dk/find-job` (200, 109,948 bytes, Next.js) — i.e. **Jobnet**. `https://www.workindenmark.dk/getting-started/finding-vacancies-in-denmark` (200) carries only two outbound job links: that Jobnet host and `https://eures.europa.eu/index_en`, and the site footer states **"WORK IN DENMARK — A part of the EURES network"** | **Highest by intent** — this is the state's own channel for non-Danish candidates | **already-covered-via-denmark + eures.** It adds no inventory: its search *is* Jobnet, which our `denmark` adapter already reads through the BFF API, and its overflow is EURES |
| **HR Manager / Talentech** (`api.hr-manager.net`) | The Danish/Nordic ATS family — previously parked | **New facts only, as instructed.** The vendor's API root is live and self-describing: `https://api.hr-manager.net/` (200, 1,521 bytes) renders a page titled **"HR Manager API"** whose entire body is *"API documentation can be found on our Wiki"*. **There is no central directory of tenant aliases.** Every enumeration shape was tried and 404s: `https://api.hr-manager.net/jobportal.svc/`, `/jobportal.svc/customers`, `/jobportal.svc/positionlist/` — all **404 "Service"**. Aliases are, however, **cheaply verifiable one at a time**: `https://api.hr-manager.net/jobportal.svc/dsb/positionlist/` → **200 `application/xml`**, `<CustomerAlias>dsb</CustomerAlias><CustomerName>DSB</CustomerName>`, `StatusCode Success`, `<Items/>`, `PositionCount 0`; `https://api.hr-manager.net/jobportal.svc/hrmanager/positionlist/` → **200, 136,474 bytes**, `<CustomerName>HR Manager as</CustomerName>`, `PositionCount 1` — one position rendered across a very rich schema (`AdvertisementUrl`, `ApplicationDue`, `ApplicationFormUrl`, `DepartmentTree`, `WorkPlaceCoordinates`, `PositionCategoryTree`, `PositionLocationTree`, `Languages`, `ProjectLeader` + email, `StartDate`, `StartDateASAP`, `Published`, `LastUpdated`). An unknown alias fails distinctly: `…/zzzznotarealtenant/positionlist/` → **HTTP 400** with a 550-byte XML error envelope — and so do `netcompany`, `kmd`, `tv2` and `coop`, i.e. those Danish names are **not** HR Manager tenants | Indirect — Danish employer career sites | **unpark, but as a footprint-driven adapter.** The 200-vs-400 split makes alias *verification* free, so this fits our existing discovery pattern exactly: harvest `hr-manager.net` career-site footprints, confirm each alias against `positionlist`, ingest. What it will never be is a directory sweep — no list of aliases is published anywhere on the host |
| **Beyond SIRI** | Danish visa registers | **Nothing found that adds employer names.** `https://www.nyidanmark.dk/robots.txt` → **404** (no robots file), and the host is reachable (Sitecore, 200s on other paths), so it is not hiding anything from us — the Positive List URLs tried simply **404**. Substantively, the Positive Lists are **occupation** lists, not employer lists | n/a | **skip.** A Positive List would be a CSOL-style reference table to join against job titles — useful scoring input, not an addition to `VisaSponsor`. The SIRI fast-track register remains the only Danish source of *employer names*, and we already hold it |

## Is anything better than the ~1k SIRI rows we hold?

No. Denmark publishes exactly one employer-level register — the SIRI fast-track
certified-companies list — and we already parse it. The two candidate additions
both fail on inspection:

1. **Workindenmark** looks like a second official channel but is a front end
   over Jobnet and EURES, both already ingested. It names no employers we do
   not already reach.
2. **The Positive Lists** are occupation whitelists, so they change *how we
   score* a posting (does this title unlock a permit?) rather than *who we know
   sponsors*. That is a separate, smaller artefact, and the pages we tried 404'd.

The realistic upgrade to Denmark is therefore not on the visa side at all — it
is IT-Jobbank, which multiplies our tech-posting coverage inside a country where
we already hold the sponsor list to join against.

## Answers to the three questions

**1. Biggest tech-relevant private boards.** **IT-Jobbank** is the find: the
tech-only Danish board, running the same Jobindex stack as the board we already
ingest, with an RSS feed that accepts `q=` and detail pages carrying full
`JobPosting` JSON-LD. **Ofir** is a `Disallow: /` and therefore off the table.
**Jobfinder** has rebranded to **techjob.dk** and bans ClaudeBot, Claude-Web and
anthropic-ai by name. **Graduateland** has been absorbed into JobTeaser, whose
sitemap is open but whose job pages answer 403 "Security checkup".

**2. Public/official beyond what we ingest.** Nothing. **Workindenmark** — the
state's own international-candidate service — routes its search to
`workindenmark.jobnet.dk` and describes itself as "a part of the EURES network".
Both ends of that are already in the pool.

**3. Anything beyond SIRI.** No. There is no second Danish employer register.
The HR Manager investigation produced the useful negative instead: **no central
tenant directory exists** on `api.hr-manager.net`, but alias validity is a free
200-vs-400 check, which makes a footprint-driven discovery adapter viable
without one.

## Checked, not worth it

- **Ofir.dk** — `robots.txt` is `Disallow: /`. Nothing else was fetched from the
  host. `https://www.ofir.dk/robots.txt`
- **Jobfinder.dk / techjob.dk** — robots names `ClaudeBot`, `Claude-Web` and
  `anthropic-ai` in an explicit "Disallow AI Crawlers" block. Respected.
  `https://techjob.dk/robots.txt`
- **Graduateland → JobTeaser** — 24,705 job URLs in an open sitemap; job pages
  403 "Security checkup" on both locales with full browser headers; the
  `/en/job-search` listing 404s.
  `https://assets-cf.jobteaser.com/sitemaps/sitemap.xml`
- **Workindenmark.dk** — no robots file, site reachable, but its job search is
  Jobnet and its overflow is EURES. Adds nothing.
  `https://workindenmark.jobnet.dk/find-job`
- **nyidanmark.dk Positive Lists** — no robots file, host reachable, tried paths
  404; and an occupation list is not an employer register either way.
  `https://www.nyidanmark.dk/robots.txt`
- **api.hr-manager.net directory endpoints** — `/jobportal.svc/`,
  `/jobportal.svc/customers` and `/jobportal.svc/positionlist/` all 404. There
  is no published alias list. Alias probing works but must be seeded from
  career-site footprints.
- **it-jobbank alternate RSS paths** — `/rss` and `/jobsoegning/rss` both 404;
  `?format=rss` is the only feed form.
