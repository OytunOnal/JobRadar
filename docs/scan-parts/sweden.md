# Source scan: Sweden

Scope: Sweden only, tech roles, visa-sponsorship bias. Primary sources only —
every row below names a URL that was actually fetched, with the status code and
payload size seen. A docs page claiming an API was never accepted as evidence;
the API had to answer. Where `WebFetch` was refused, the URL was retried from
Node with a desktop-Chrome User-Agent before the site was declared closed.

Already covered and therefore out of scope: **sweden (Arbetsförmedlingen JobTech
JobSearch API — already ingested)**, thehub, eures, arbeitnow, remotive,
remoteok, jobicy, himalayas, weworkremotely, freehire, workingnomads, themuse,
adzuna, jsearch/indeed, linkedin, nofluffjobs, and the ~30 ATS platforms that
already have discovery adapters — **including Teamtailor, which is Swedish and
is already an adapter**, so Swedish company boards on it are reachable today.

Scanned 2026-09-03.

## Findings

| Board / source | Type | Machine door? | Verified URL | Visa relevance | Verdict |
| --- | --- | --- | --- | --- | --- |
| **JobTech JobStream** (`jobstream.api.jobtechdev.se`) | Official — Arbetsförmedlingen's *change stream* sibling of the JobSearch API we already ingest | **Yes — keyless JSON, verified.** `https://jobstream.api.jobtechdev.se/stream?date=2026-09-02T00:00:00` → **200**, `application/json`, **33,091,241 bytes** (one day of changes). Returns a bare array of full ad objects — `id`, `external_id`, `original_id`, `webpage_url` (`arbetsformedlingen.se/platsbanken/annonser/{id}`), `logo_url`, `headline`, `application_deadline`, `number_of_vacancies`, `description.text` (**full ad body**) — i.e. the same payload as JobSearch, but addressed by *change time* rather than by query | Same as Platsbanken: no sponsorship field, but full text for our own classifiers | **adapter-worthy (small) — top pick for Sweden**, and it is an *upgrade to an existing source*, not a new one. See below |
| **JobTech Historical Ads** (`historical.api.jobtechdev.se`) | Official archive | **Yes — keyless JSON.** `https://historical.api.jobtechdev.se/search?limit=1` → **200**, reporting `total: 8,251,026` ads / `positions: 15,538,520`, same hit shape as JobSearch (`id`, `original_id`, `webpage_url`, `logo_url`, `headline`, `application_deadline`, plus a `label` array e.g. `['nystartsjobb','etableringsjobb']`) | None — these are expired ads | **skip for ingest, note for analysis.** 8.25M historical Swedish ads is a genuine research asset (base rates for the seniority/workMode detectors, employer hiring history), but it is not a source of live jobs and must never enter the pool |
| **JobTech Links** (`links.api.jobtechdev.se`) | Official *aggregator* — ads collected from job sites beyond Platsbanken | **Yes — keyless JSON**, and I measured its actual source mix rather than trusting the premise. `https://links.api.jobtechdev.se/joblinks?q=developer&limit=2` → **200**, `total: 598`; `?limit=0` → `total: 42,422` overall. Hit fields: `id, headline, brief, occupation_group, occupation_field, employer, workplace_addresses, publication_date, source_links[{label,url}]` | **The measurement kills it.** Over 92 hits for `q=utvecklare`, `source_links` labels tallied **`arbetsformedlingen.se`: 99, `ingenjorsjobb.se`: 1**. It is ~99% a re-index of Platsbanken, which we already ingest — and it carries only a `brief`, not the full description | None | **skip as an ingest source; park as a *discovery* probe.** Its one real use is the opposite of ingest: `source_links.label` enumerates which Swedish boards exist and are actively publishing (it surfaced `ingenjorsjobb.se` and `workmatch.io` unprompted). That is a cheap feed for `discovery/`, not for the pool |
| **Demando** | Swedish **tech-only** job board / reverse-recruitment marketplace | **Yes — `JobPosting` JSON-LD, confirmed by fetch.** `https://demando.se/robots.txt` → **200**, `User-agent: *` / `Allow: /`, **no AI-crawler ban**, and it declares **four sitemaps** including a positions one. `https://demando.se/sitemap/positions-sitemap.xml` → **200**, `text/xml`, **206,476 bytes** of `/company/{slug}/jobs/{slug}` URLs with `lastmod` (note: each posting is listed twice, once for `demando.se` and once for the `demando.io` mirror — dedupe on path). Detail `https://demando.se/company/heja-sports-ab/jobs/senior-front-end-app-engineer-react-native` → **200, 135,374 bytes, 2 JSON-LD blocks**: `Organization` + **`@type: JobPosting`** carrying `title` and full HTML `description`. `__NEXT_DATA__` also present as a fallback | Moderate — no visa facet, but the board is **100% tech**, Stockholm-centred, and heavily English-language (the sampled ad was entirely in English), which correlates strongly with sponsorship willingness | **adapter-worthy — best private board in Sweden** |
| **Migrationsverket "certifierad arbetsgivare"** | The visa lead we were asked to re-verify | **No list is published.** `https://www.migrationsverket.se/arbetsgivare/hogkvalificerad-arbetskraft.html` → **200, 88,265 bytes**; fetched and read in full — it describes recruiting highly-qualified non-EU staff and carries news about permit rules, but contains **no mention of a certification scheme and no link to any list of certified employers**. Targeted search confirms the scheme exists but is an **internal service routine, not a statutory register**: certification buys a fast track (target 10 working days for new applications, 20 for extensions), and reporting on it quotes Migrationsverket's press office for company counts (27 companies as of 2017) precisely *because* no public list is published | n/a | **skip — dead lead, and it confirms `src/lib/visa/sponsors.ts`.** Sweden certifies employers but publishes nothing. Contrast Finland, whose Migri *does* publish a weekly-updated certified-employer list at `https://migri.fi/en/certified-employers` — out of scope here, but a live lead for whoever takes FI |
| **Jobbland.se** | Swedish generalist aggregator | Technically SSR, but **robots bans us.** `https://jobbland.se/robots.txt` → **200, 2,057 bytes**. It is a **whitelist**: named agents (Googlebot, Bingbot, DuckDuckBot, Applebot, LinkedInBot, facebookexternalhit, AhrefsBot, Baiduspider, SemrushBot, Browsershots and **GPTBot**) each get `Allow: /` with `Disallow: /api*`; the file then ends with `User-agent: *` / **`Disallow: /`**. ClaudeBot is not whitelisted, so **we fall under the blanket deny** | Low — generalist, Swedish-language | **skip — robots ban.** Note the irony worth recording: GPTBot is explicitly permitted and we are not. Respected regardless |
| **TheLocal.se (jobs)** | English-language Swedish news site with a jobs section | n/a — **explicitly bans ClaudeBot by name.** `https://www.thelocal.se/robots.txt` → **200, 1,352 bytes**, containing `User-agent: ClaudeBot` / `Disallow: /` and `User-agent: anthropic-ai` / `Disallow: /`, alongside bans for GPTBot, ChatGPT-User, CCBot, Bytespider, PerplexityBot and archive.org_bot | Would have been high (English-language, expat audience) | **skip — named AI-crawler ban, respected.** One of the clearest ClaudeBot bans found in this scan |
| **Academic Work** | Large Swedish staffing/consultancy firm, student and junior focus | **Robots-permissive but no structured door found.** `https://www.academicwork.se/robots.txt` → **200**, `User-Agent: *` / `Allow: /`, disallowing only `/api/`, `/admin/`, `/auth/`, `/_next/`; **no AI ban**; declares a sitemap. `https://www.academicwork.se/sitemap.xml` → **200, 112,307 bytes**, but the entries sampled are **content and campaign pages** (`/aw-accelerate/*`, `/jobbsokande/*`, `/auth/sign-in`), not vacancies. Listing `https://www.academicwork.se/lediga-jobb` → **200, 373,500 bytes** with **0 JSON-LD blocks**, no `JobPosting`, no `__NEXT_DATA__`, no `__NUXT` — and `/api/` (the obvious backing door) is robots-disallowed | Low — staffing agency, junior/student roles, Swedish-language, and consultancy intermediation is a poor sponsorship bet | **skip** — the only machine door is the one robots forbids |
| **Framtid.se** | Career-guidance site (occupations, education), not really a job board | Robots is open — my first read of it was **wrong and is corrected here**: the file is 24 bytes, `User-agent: *` / `Disallow:` with an **empty value, which means allow-all**, not `Disallow: /`. But there is no board behind it: `https://www.framtid.se/ledigajobb` → **404** | None | **skip** — a careers-guidance publisher, not a vacancy source |
| **relocate.me** (Sweden slice) | Relocation/visa-focused board, pan-EU | Partial — SSR HTML only. `https://relocate.me/robots.txt` → **200**, permissive (disallows only `/install/`, `/manager/`, `/uploads/`). `https://relocate.me/international-jobs/sweden` → **200, 78,065 bytes**, SSR, but the **only JSON-LD is `BreadcrumbList`** — no `JobPosting`, so cards must be scraped from markup | **Highest by construction** — relocation and visa support are the site's whole premise | **park — and not a Nordics item.** Pan-EU; scoping an adapter to SE/NO would waste most of it. Belongs to a cross-country issue, not #28 |

## The Swedish find is an upgrade, not a new board

Sweden's honest situation: we already ingest the best source in the country
(Platsbanken via JobTech JobSearch), and the private tier is thin — one genuinely
good tech board (Demando), one that bans us (Jobbland), one that bans us by name
(TheLocal), and one with no door (Academic Work). So the highest-value move is
**JobStream**, which changes *how* we ingest what we already ingest:

- **JobSearch** (current) answers "which ads match this query, right now". To
  stay fresh you re-run queries and diff.
- **JobStream** answers "what changed since timestamp T" — one call, a bare
  array of complete ad objects including `description.text`. The verified
  fetch for a single day was 33 MB, which is the whole national delta.

That maps directly onto our `queue/` + `ingest/` split: store the last stream
timestamp, fetch the delta, and stop re-querying. It also removes the silent
failure mode of query-based ingest, where an ad that no query happens to match
is simply never seen. Both APIs are keyless and from the same authority, so this
is a low-risk swap rather than a new integration.

## Answers to the three questions

**1. Biggest tech-relevant private boards.** **Demando** is the real find:
tech-only, robots-permissive with no AI ban, a 206 KB positions sitemap for
enumeration, and `JobPosting` JSON-LD on every detail page — everything an
adapter needs, verified by fetch. The rest of the tier is closed or empty:
**Jobbland** whitelists eleven named bots (GPTBot among them) and blanket-denies
everyone else, **TheLocal.se** bans ClaudeBot and `anthropic-ai` by name, and
**Academic Work** renders its listings client-side behind a robots-disallowed
`/api/`. **Framtid.se** is a careers-guidance publisher with no board at all.

**2. Public/official beyond the JobTech API we use.** Yes — JobTech is a family,
and we use one member. **JobStream** is the change-stream sibling and is the
recommendation above. **Historical Ads** (8.25M ads, 15.5M positions) is a real
analysis asset for base rates but must stay out of the live pool. **JobTech
Links** looked like the exciting one — an official aggregator of *non*-Platsbanken
sources — but measuring its `source_links` labels showed 99 of 100 pointing back
at `arbetsformedlingen.se`. It is worth keeping only as a `discovery/` probe for
enumerating Swedish boards, never as an ingest source.

**3. Visa registers — negative, and now verified for Sweden.** Migrationsverket
runs a certification scheme for employers, but it is an **internal fast-track
routine, not a statutory register**, and **no list of certified employers is
published**: the highly-qualified-workforce employer page does not mention
certification at all, and press coverage has to ask Migrationsverket's press
office even for a company *count*. **The claim in `src/lib/visa/sponsors.ts`
stands for SE and needs no edit.** The one adjacent lead worth passing on: **Finland's
Migri does publish a certified-employer list** (`https://migri.fi/en/certified-employers`),
which contradicts the "SE/NO/FI publish no list" grouping in that comment for
the **FI** third of it — out of scope for me, but whoever takes Finland should
verify it, and the comment may need a correction afterwards.

## Checked, not worth it

- **Jobbland.se** — robots is a bot whitelist ending in `User-agent: *` /
  `Disallow: /`; ClaudeBot is not on the list. Banned, respected.
- **TheLocal.se** — `User-agent: ClaudeBot` / `Disallow: /` and
  `User-agent: anthropic-ai` / `Disallow: /`, verbatim. Banned by name.
- **Academic Work** — 373 KB listing page with zero JSON-LD and no SSR data
  blob; the backing `/api/` is robots-disallowed. Junior/staffing inventory
  anyway.
- **Framtid.se** — robots is allow-all (my initial `Disallow: /` reading was a
  newline-rendering artifact and is corrected above), but `/ledigajobb` 404s;
  it is a careers-guidance site, not a board.
- **JobTech Links** — official and keyless, but 99/100 sampled `source_links`
  point back to Platsbanken and hits carry only a `brief`. Retained as a
  discovery probe, not an ingest source.
- **JobTech Historical Ads** — 8.25M expired ads. Valuable for measurement,
  disqualified for the pool.
- **Migrationsverket certified employers** — scheme exists, list does not.
- **relocate.me** — parked and deferred to a cross-country issue rather than
  scoped to Sweden.
