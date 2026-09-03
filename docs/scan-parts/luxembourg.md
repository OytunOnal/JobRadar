# Source scan: Luxembourg

Scope: Luxembourg only, tech roles, visa-sponsorship bias. Every row names a URL
that was actually fetched with a desktop-Chrome User-Agent; where that was
blocked, a second attempt used the Wayback Machine or a different UA before the
door was declared closed. `robots.txt` was read in full on every board and its
`Sitemap:` lines were followed rather than guessed.

Scanned 2026-09-03.

## Read this first: the market is thin by population, but not empty

Luxembourg has ~680,000 residents, so it should be one of the smallest scans in
this project. It roughly is — but one clean door changes the picture:
**Silicon Luxembourg's job board (siliconluxembourg.lu/jobs)** turned out to
have a fully open WordPress REST API with **392 live job postings**
(`X-WP-Total: 392`, confirmed by direct API call), 382 of them touched in
August 2026 alone, spanning genuine tech roles — cybersecurity, cloud
architecture, data engineering, robotics — including postings for
**LuxProvide** (operator of the MeluXina supercomputer, Luxembourg's
national HPC/AI/quantum infrastructure) and Amazon's Luxembourg operations
(EU logistics/tech hub). That single board is bigger, by itself, than the
entire declared national vacancy stock of Iceland (710) is close to a third of
it.

Economy-wide, ADEM's own published statistics put **the entire national vacant-
position stock at 7,183** as of 31 July 2026 (`Interim` 352 + `Emploi` 6,682 +
`Mesure` 149 — `https://download.data.public.lu/resources/chiffres-cles-de-
ladem/20260826-051715/offres-series.csv`, row `"31-07-2026"`), but that is an
aggregate count with **no machine-readable per-posting feed** — the ADEM
JobBoard that holds those individual postings sits behind a mandatory login
(see below). So the honest reachable pool for this project is not "a slice of
7,183" — it is the **392 postings on Silicon Luxembourg**, a curated,
English-language, tech-and-startup-labelled board that is open today, plus
whatever the ATS-platform adapters already reach at Luxembourg-based
companies (LuxProvide, Amazon, POST Luxembourg, banks, fintechs — outside this
scan's scope per the brief). LHoFT's fintech-specific board uses the identical
clean API pattern but currently holds **zero** postings — parked, not built,
until it has inventory.

## Findings

| Board / register / service | Type | Machine door? | Verified URL | Visa relevance | Verdict |
| --- | --- | --- | --- | --- | --- |
| **ADEM — data.public.lu datasets** | National employment agency, open-data catalogue entries | **Yes, reachable — but historical/aggregate only, not a live vacancy feed.** `https://data.public.lu/api/1/organizations/56f3d70f0d6ceb1b0b4030eb/datasets/` (200) lists exactly **2 datasets** from ADEM's own org account: **"Skills required in ADEM job vacancies"** (`https://data.public.lu/api/1/datasets/skills-required-in-adem-job-vacancies/`, 200) — quarterly CSV dumps of *closed* vacancy-skill pairs 2015–2026, whose own description states **"Active job ads (i.e., vacancies that are currently open) are not displayed"** — and **"Chiffres-clés de l'ADEM"** (`https://data.public.lu/api/1/datasets/5e538be8f176a1373747c0f2/`, 200), monthly aggregate counts (`offres-details.csv`, `offres-series.csv`) with **no individual posting records**, only totals by contract type and canton | None — the underlying microdata is built from vacancies **"employers in Luxembourg are legally obliged to transfer... to ADEM"** (dataset description, quoted verbatim), which is the mandatory-declaration mechanism, not a visa register | **park.** Clean, keyless, well-documented API — genuinely the most "official" door found — but structurally unusable for live postings. Worth revisiting only if ADEM ever exposes the *open* vacancies as a resource; currently it explicitly does not |
| **ADEM JobBoard** (`jobboard.adem.lu`) | The actual live vacancy portal referenced by the datasets above | **No — full login wall, even for `/`.** `https://jobboard.adem.lu/robots.txt` (200): `Disallow: /files/files/` only — the *most* permissive robots.txt in this scan — but `https://jobboard.adem.lu/` returns **HTTP 303** redirecting straight to `https://jobboard.adem.lu/login` (`<title>ADEM JobBoard: Identifiez-vous</title>`, 200, 16,447 bytes), and there is no unauthenticated listing path. ADEM's own page confirms the gate: `https://adem.public.lu/fr/jobboard.html` (200) reads **"Connectez-vous pour consultez les dernières d'emploi et postulez aux annonces"** | n/a — job seeker must register (any nationality can) to browse at all | **skip.** Permissive robots, zero access — the door is architectural, not robots-based, so there is nothing to crawl even though nothing forbids it |
| **Silicon Luxembourg jobs board** (`siliconluxembourg.lu/jobs`) | Tech/startup ecosystem media outlet's dedicated job board | **Yes — wide open, and structured.** `https://www.siliconluxembourg.lu/robots.txt` (200): `Disallow:` (nothing blocked), `Sitemap: http://www.siliconluxembourg.lu/sitemap_index.xml`. That index (200) declares `http://www.siliconluxembourg.lu/silicon_job-sitemap.xml` — **393 `<loc>`s** (392 postings + the index page), lastmod dates **382 in 2026-08, 5 in 2026-09, 5 in 2026-07** — i.e. essentially all live and current. The real door is better than the sitemap: the custom post type is exposed via the **WordPress REST API**, keyless: `http://www.siliconluxembourg.lu/wp-json/wp/v2/silicon_job?per_page=1` → **`X-WP-Total: 392`**, and `?per_page=3` returns full `title`, `content.rendered` (complete job description HTML), `date`, `modified`, `link` for each posting — e.g. `{"title":{"rendered":"Head of Security"}, "link":"http://www.siliconluxembourg.lu/jobs/head-of-security/", "date":"2026-09-02T17:40:52"}` for a LuxProvide (MeluXina supercomputer) CISO role. Sample titles confirm tech density: `virtualization-engineer`, `deep-cloud-architect-ovh-clever-cloud-cloud-native`, `data-engineer-scot-fo-science-and-technology`, `business-intelligence-engineer-scot`, plus a large Amazon Luxembourg contingent (`applied-scientist-procurement`, `amxl-supply-chain` roles). Apply links point out to `skillbourg.com` (the underlying ATS/matching backend), confirmed on `https://www.siliconluxembourg.lu/jobs/head-of-security/` (200): `href="https://skillbourg.com/jobs/2msvozZk7udmYMYW0qZUTe?..."` — no `JobPosting` JSON-LD schema is present (checked, `@type` list has no `JobPosting`), so parsing is sitemap + REST content, not structured schema.org data | Moderate-high — the board is explicitly English-language, tech-and-startup-scoped, and reaches multinational employers (Amazon, LuxProvide) that plausibly sponsor | **adapter-worthy — top Luxembourg pick.** Keyless REST API, exact count via `X-WP-Total`, full HTML descriptions, near-daily freshness. The single richest door found in this scan |
| **LHoFT jobs** (`lhoft.com/jobs`) | Luxembourg House of Financial Technology — the fintech cluster's own board | **Yes, structurally identical clean door — currently empty.** `https://lhoft.com/robots.txt` (200): `Disallow:` (nothing blocked beyond calendar `ical`/`tribe-bar` params), `Sitemap: https://lhoft.com/sitemap_index.xml`. Uses the same WP Job Manager plugin: `https://lhoft.com/wp-json/wp/v2/types/job_listing` (200) gives `"rest_base":"job-listings"`; `https://lhoft.com/wp-json/wp/v2/job-listings?per_page=1` → **`X-WP-Total: 0`, `X-WP-TotalPages: 0`** | High in principle — fintech is one of Luxembourg's named high-salary, internationally-hiring clusters — but moot while empty | **park.** Same clean-API pattern as Silicon Luxembourg, zero cost to add later, but zero current inventory — nothing to fetch today |
| **Moovijob.com** | The dominant Luxembourg private job board (per market-map research and repeated third-party mentions) | **No — Cloudflare-blocked on every path tried.** `https://www.moovijob.com/robots.txt` → **HTTP 403**, Cloudflare "Just a moment…" managed challenge (confirmed via direct curl with a desktop-Chrome UA and independently via the `WebFetch` tool, both 403). `https://en.moovijob.com/robots.txt` → same **403**. A Wayback Machine snapshot from 2026-01-14 (`http://web.archive.org/web/20260114005731/https://www.moovijob.com/robots.txt`, 200) shows a *historically* permissive robots.txt (no blanket `Disallow: /`, only admin/legacy paths blocked, no `Sitemap:` line declared even then) — so the block is a live anti-bot layer added on top, not a robots policy | High — described elsewhere as Luxembourg's largest board, cross-border/foreign-hiring heavy | **skip (blocked).** Historically the door was open in principle but carried no sitemap even then; today it is Cloudflare-gated outright. Revisit only if the Cloudflare posture changes |
| **jobs.lu / en.jobs.lu** | Second major private board; hosts a dedicated "English-speaking jobs" section | **No — Akamai-blocked on every subdomain tried.** `https://www.jobs.lu/robots.txt` → **HTTP 403** `Access Denied` (Akamai edge, `errors.edgesuite.net` reference ID), reproduced with a Googlebot UA. `https://en.jobs.lu/robots.txt` → same 403 Akamai block. A 2020-04-28 Wayback snapshot exists but is six years stale, so not used as evidence of current state | High — the English-speaking section is squarely the population this project wants | **skip (blocked)** |
| **Monster.lu** | Historically a standalone LU Monster site | **No — the LU site is dead, folded into monster.com, which is bot-walled.** `https://www.monster.lu/robots.txt` → **HTTP 301** to `https://www.monster.com/fr/`, whose `/robots.txt` fetch resolves to a **DataDome CAPTCHA page** (`geo.captcha-delivery.com`, HTTP 403). A 2025-01-19 Wayback snapshot of the old `monster.lu` robots.txt shows it once had real per-job sitemaps (`Sitemap: https://www.monster.lu/jobview-zuq65ljydx-lu.xml`), confirming the standalone LU site existed until sometime in the last ~18 months | n/a | **skip — dead as a national board, current host is bot-walled** |
| **jobsinluxembourg.eu** | English-speaking-professionals job site, part of the multi-city "Jobs In Network" template franchise (jobsinberlin.eu, jobsinvienna.com, etc.) | **Robots wide open, but the inventory is empty.** `https://jobsinluxembourg.eu/robots.txt` (200): no disallows, `Sitemap: https://jobsinluxembourg.eu/sitemap_index.xml`. That index (200) declares a dedicated `sitemap/livejobs.xml` — fetched (200, following one redirect) and it is a **valid but completely empty** `<urlset>` (0 `<loc>` entries). The homepage (200, 142,730 bytes) contains **zero `/job/` links** and no "X jobs" counter with a real number | Positioned exactly at the target population (English-speaking professionals) but nothing to show for it | **skip — clean door, no inventory.** A templated network site that is currently dormant for Luxembourg; worth a re-check later since the door costs nothing to re-open |
| **Work in Luxembourg** (`workinluxembourg.com`) | National talent-attraction portal (Ministry of Economy + ADEM + Chamber of Commerce + Luxinnovation) | **Robots open, but it is not a jobs feed.** `https://workinluxembourg.com/robots.txt` (200): `Allow: /`, `Sitemap: https://www.workinluxembourg.com/sitemap.xml`. The sitemap (200, 13,194 bytes, ~1 URL per line of CMS content) lists informational pages only. `/get-started/job-search` (200, 184,360 bytes) contains no job listings and links out only to `adem.public.lu`; `/for-employers/hiring-international-talent` (200) contains no employer directory, linking only to guichet.public.lu and adem.public.lu; `/work/careers-opportunities` (200) links to a Power BI labour-market dashboard, not a company list | Highest available context value — it is the government's own relocation/talent guide, naming the market's structural features (foreign workforce, cross-border commuters, EU-institution cluster) that motivated this scan | **skip as a feed, keep as a primary source.** No postings, no employer directory — it is the market map, same role Iceland's `work.iceland.is` played in that scan |
| **Luxembourg Trade & Invest — international talent pool page** | Investment-promotion agency's talent page | **Robots open; content is not a directory.** `https://luxembourgtradeandinvest.com/robots.txt` (200): `Allow: /`, `Sitemap: https://luxembourgtradeandinvest.com//sitemap.xml`. `https://luxembourgtradeandinvest.com/choose-luxembourg/explore-luxembourg-as-your-next-business-destination/international-talent-pool` (200, 171,971 bytes) contains no company list — only investment-promotion navigation (`/our-international-network`, regional trade-office pages) | None found | **skip — no employer directory exists here** despite the promising name |
| **Guichet.lu — Blue Card / third-country salaried worker procedures** | Official government procedure pages (single work-and-residence permit, EU Blue Card) | **Yes, reachable, and definitive on the register question.** `https://guichet.public.lu/fr/citoyens/immigration/plus-3-mois/ressortissant-tiers/hautement-qualifie/salarie-hautement-qualifie.html` (200, 1,032,648 bytes). States the application **"doit être introduite par le salarié"** (must be filed by the employee, not a pre-approved employer) and that the employer's sole formal obligation ahead of hiring is the ADEM vacancy declaration. A full-text search of the page for "liste"/"registre"/"agréé" turns up **no published list of approved or registered sponsoring employers** — only unrelated visa-country and sworn-translator lists | This *is* the visa-relevance question, answered directly | **not a data source — this settles Q3.** No employer register exists to seed a company list from |
| **startup.jobs (Luxembourg location page)** | Global multi-city startup job board | **Robots open in principle, content page Cloudflare-blocked.** `https://startup.jobs/robots.txt` (200, permissive, `Sitemap: https://cdn.startup.jobs/sitemaps/startupjobs/sitemap.xml.gz`, explicitly rate-limits `ClaudeBot`/`GPTBot` rather than banning them). But `https://startup.jobs/locations/luxembourg` → **HTTP 403**, Cloudflare `<title>Just a moment...</title>` challenge | Global board, not Luxembourg-specific | **skip (blocked on content; also out of this scan's per-country scope as a generic multi-city board)** |
| **Wellfound (location/luxembourg)** | Global startup job board (formerly AngelList Talent) | Robots open (`https://wellfound.com/robots.txt`, 200, permissive, sitemap declared) but not fetched further | Global board, not Luxembourg-specific | **not pursued — generic global board, same category as startup.jobs; noted but out of scope for a country-specific door** |

## Answers to the three questions, directly

**1. ADEM.** No live, machine-readable vacancy feed exists. `data.public.lu`
carries exactly two ADEM datasets, both confirmed by their own descriptions to
be historical/aggregate (closed-vacancy skill microdata; monthly stock
counts) — the aggregate count for 31 July 2026 is **7,183 vacant positions
economy-wide** (`offres-series.csv`), which is a useful sizing anchor but not
a postings feed. The live postings live on `jobboard.adem.lu`, which
redirects `/` straight to a mandatory login page — no public browse path
exists despite a nearly-unrestricted `robots.txt`.

**2. Private boards.** Moovijob (Cloudflare 403) and jobs.lu/en.jobs.lu
(Akamai 403) — the two boards most often named as dominant — are both
bot-walled today. Monster.lu is dead as a standalone site, folded into the
DataDome-protected monster.com. The doors that *are* open turned out to be
tech-specific, not the generalist incumbents: **Silicon Luxembourg**
(392 live postings, open WordPress REST API, `X-WP-Total` confirmed) and
**LHoFT** (identical clean API, 0 postings today). jobsinluxembourg.eu has an
open robots.txt and a dedicated live-jobs sitemap, but that sitemap is
verified empty.

**3. Visa/sponsorship.** No published register of approved or certified
sponsoring employers exists for Luxembourg's single work-and-residence permit
or the EU Blue Card — confirmed by full-text search of the relevant
guichet.public.lu procedure page. `workinluxembourg.com` and
`luxembourgtradeandinvest.com`, the two candidate "talent attraction" sites,
were checked in full and neither publishes an employer directory — both are
narrative/informational only. The one real seedable signal is structural, not
a register: every open vacancy at a Luxembourg employer is, by law, declared
to ADEM first (quoted above), which is why ADEM's own skills-microdata
dataset exists — but that channel is closed to live scraping.

## Checked, not worth it

- **ADEM JobBoard** (`jobboard.adem.lu`) — robots.txt allows everything except
  `/files/files/`, but `/` 303-redirects to a mandatory login page with no
  public listing path. `https://jobboard.adem.lu/robots.txt`
- **Moovijob.com** — Cloudflare managed challenge, HTTP 403 on `/robots.txt`
  on both `www.` and `en.` hosts, confirmed twice (curl + WebFetch).
  `https://www.moovijob.com/robots.txt`
- **jobs.lu / en.jobs.lu** — Akamai `Access Denied`, HTTP 403 even with a
  Googlebot UA, on both hosts. `https://www.jobs.lu/robots.txt`
- **Monster.lu** — 301s into `monster.com/fr/`, which serves a DataDome
  CAPTCHA (403). `https://www.monster.lu/robots.txt`
- **jobsinluxembourg.eu** — open robots and a declared `livejobs.xml`
  sitemap, but that sitemap is a valid, empty `<urlset>` and the homepage
  carries zero `/job/` links. `https://jobsinluxembourg.eu/sitemap/livejobs.xml`
- **workinluxembourg.com** — government relocation portal; open robots and
  sitemap, but the sitemap is 100% CMS content pages, no jobs, no employer
  directory. `https://workinluxembourg.com/robots.txt`
- **luxembourgtradeandinvest.com** — investment-promotion site; open robots,
  no employer directory found on its "international talent pool" page.
  `https://luxembourgtradeandinvest.com/robots.txt`
- **startup.jobs** — permissive robots.txt, but the Luxembourg location page
  itself is behind a Cloudflare JS challenge (403).
  `https://startup.jobs/locations/luxembourg`
- **Wellfound** — global multi-city board with an open, permissive robots.txt;
  not pursued further as out of scope for a Luxembourg-specific door.

## Main-session audit, 2026-09-04

**Silicon Luxembourg is open, counted, and still parked — for the same reason
as Actiris.** Everything the scan reported holds: robots.txt is 181 bytes with
an empty `Disallow:` (allow-all), no AI-crawler ban, wp-json unblocked; the
REST endpoint answers 200 keyless with `X-WP-Total: 392`; and
`content.rendered` carries a full 7,385-character body.

But it publishes **no employer name** — not in the API record (`meta` is
empty, `acf` is an empty array), not in the rendered page, and not as JSON-LD.
The image alt texts that look promising are sponsor banners (Amazon, SES),
not the hiring company. `company` is half our dedupe content key, the join to
the sponsor registers, the name-probe seed and the second line of every card,
so 392 rows of "?" would cost more than they add.

The employer is often nameable from the prose — the first posting describes
MeluXina, which identifies LuxProvide to a human — but recovering it means an
LLM extraction pass over every row, which is a different pipeline and poor
value for 392 postings. Parked with the door recorded, so it is one decision
away if the product ever widens.

**Luxembourg's honest verdict: nothing adapter-worthy.** ADEM publishes no
live feed (its open-data sets are historical, and the live jobboard redirects
to a mandatory login), Moovijob and jobs.lu — the two boards usually called
dominant — are Cloudflare- and Akamai-walled, Monster.lu is dead, and no
register of permit-sponsoring employers is published. A structurally
interesting market (half the workforce foreign, English and French working
languages) that is nonetheless closed to us.
