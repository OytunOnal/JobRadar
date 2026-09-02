# ATS market scan

Which ATS platforms and job boards European tech companies use that JobRadar
does not yet cover. Every claim below carries the URL that was actually
fetched; marketing pages were not accepted as evidence.

## 2026-09-02 — mid-size ATS + internal-evidence boards + AI-native wave

Method: candidates from the pool's unrecognized posting URLs plus a sweep of
EU SMB ATS vendors. For each: locate a real client board, then try for an
unauthenticated JSON/XML endpoint. WebFetch where possible; curl with a
browser UA where the site blocks the fetcher (nofluffjobs, justjoin.it).

### Summary

| Platform / board | Hosting pattern | Public endpoint | EU / visa relevance | Verdict |
|---|---|---|---|---|
| nofluffjobs.com | own board (PL/HU/CZ/SK/UA/NL) | **yes, JSON** — `GET https://nofluffjobs.com/api/posting` returns the full posting list unauthenticated (fetched via curl + browser UA; WebFetch itself is WAF-blocked) | high — Poland is an EU visa route, salaries public | **adapter-worthy** |
| Manatal (careers-page.com) | shared path `www.careers-page.com/{slug}` (fetched: https://www.careers-page.com/lifelancer) | **yes, JSON** — `https://www.careers-page.com/api/v1.0/c/{slug}/jobs/?page=1&page_size=50` paginated, no auth (fetched with slug `lifelancer`: count 9313, `next`/`results` structure); pattern documented at https://developers.manatal.com/reference/career-page_jobs_list | medium — agency-heavy tenant base, but already appears in the pool | **adapter-worthy** |
| huntukvisasponsors.com | own board | no JSON (robots.txt disallows `/api/`, fetched https://huntukvisasponsors.com/robots.txt), but `/jobs` is server-rendered cards with sponsorship-likelihood rating, `/job/{slug}-at-{company}-{id}` (fetched https://huntukvisasponsors.com/jobs — "70,600+ live jobs", synced from gov.uk register); sitemap fetched https://huntukvisasponsors.com/sitemap.xml (300+ role pages) | **very high** — the exact user need (sponsored roles), UK | **adapter-worthy** |
| justjoin.it | own board (PL) | old `/api/offers` is **404** (fetched https://justjoin.it/api/offers); `api.justjoin.it/v2/user-panel/offers` returns **503** even via curl (WAF). Sitemap chain works: robots → https://justjoin.it/sitemaps/active-jobs.xml → https://public.justjoin.com/justjoinit/sitemaps/active-jobs.xml → https://justjoin.it/sitemaps/active-jobs/part0.xml with `/job-offer/{slug}` entries (all fetched) | high — Poland tech | **adapter-worthy** (sitemap + per-offer page, not API) |
| HR Manager (Talentech) | per-tenant alias on shared API host | **yes, XML** — `https://api.hr-manager.net/jobportal.svc/{alias}/positionlist/xml/?incads=1` unauthenticated, full ads + apply URLs (fetched with alias `regionsyddanmark`: 8 live positions) | medium-high — Nordics; Talentech is the leading Nordic ATS family | **adapter-worthy** (needs alias harvesting; no central directory found) |
| Onlyfy / Prescreen (Xing) | `{tenant}.jobbase.io` 307-redirects to `{tenant}.onlyfy.jobs` (fetched https://oebv.jobbase.io → https://oebv.onlyfy.jobs/, 24 jobs, `/en/job/{id}`) | no JSON found on the board page | high — DACH | **adapter-worthy** (name-probe pattern like personio; HTML) |
| duunitori.fi | own board (FI) | no — robots.txt default-denies all bots except an allowlist (Claude-User is on it) and disallows `/api/` (fetched https://duunitori.fi/robots.txt); sitemap index fetched https://duunitori.fi/sitemap.xml — `sitemap-jobentry.xml` split over 85 pages | medium — Finland | park (sitemap route exists but robots posture is restrictive; revisit if Finland matters) |
| Jobylon | shared domain `emp.jobylon.com/jobs/{id-slug}` and `/companies/{id}-{slug}/` (fetched https://emp.jobylon.com/companies/138-volumental/); `/jobs/latest/` listing is now 404 (fetched) | Feed API is unauthenticated **but keyed by a non-guessable per-company hash** (fetched https://developer.jobylon.com/feed-api); `emp.jobylon.com/sitemap.xml` returns 200 (curl) | medium-high — Sweden/Nordics | park (lead: inspect emp.jobylon.com sitemap for cross-tenant job URLs) |
| solid.jobs | own board (PL) | `/api/offers` is 404 (fetched https://solid.jobs/api/offers); sitemap index has fresh `sitemap-offers.xml` (fetched https://solid.jobs/sitemap.xml) | medium — small PL board | park (justjoin + nofluffjobs cover PL better) |
| rejobs.org | own board (renewables, global) | sitemap only — index with 13 job files, entries like `/en/renewable-energy-jobs/{id}-{slug}` incl. non-EU (fetched https://rejobs.org/sitemap.xml and sitemap-jobs-1.xml) | low — niche vertical, global mix | park |
| remoteyeah.com | own board | sitemap only (fetched https://remoteyeah.com/sitemap.xml — `sitemap-jobs-1.xml`); permissive robots | low-medium — small remote board | park |
| HiBob Hiring | `{tenant}.careers.hibob.com` (fetched https://hibob-e360.careers.hibob.com/ — JS shell, title "Careers", no data or API refs in HTML) | no — Hiring API needs a service user (fetched https://apidocs.hibob.com/docs/how-to-use-hiring-api-careers-page); board XHR not discoverable without JS | medium — growing EU/IL mid-market | park (needs headless browser or endpoint reverse-engineering) |
| Homerun | `{tenant}.homerun.co` (fetched https://marvia.homerun.co — server-rendered board, no JSON/API refs) | no public JSON found | medium — NL/Benelux SMBs | park (candidate for the name probe; HTML only) |
| Kula (AI-native) | `careers.kula.ai/{account}` (curl https://careers.kula.ai/wizcommerce → 200, no `/api/` or `__NEXT_DATA__` in HTML) | no JSON found | low — mostly US/India tenants seen | park |
| Teamdash | `{tenant}.teamdash.com/p/job/{id}/{slug}` (fetched https://eegrafton.teamdash.com/p/job/jgukJTry/recruitment-coordinator — server-rendered full posting) | no JSON found | low-medium — Baltics/EE | park |
| Gem ATS (AI-native) | `jobs.gem.com/{slug}` (fetched https://jobs.gem.com/mission — SPA shell, zero data in HTML; curl found no API refs) | no | low — US-centric | skip |
| Dover | `app.dover.com/jobs/{slug}` (fetched https://app.dover.com/jobs/dover — SPA shell; curl shows Cloudflare Turnstile) | no | low — US-centric | skip |
| Zoho Recruit | `{tenant}.zohorecruit.com/jobs/Careers` per Zoho docs, but the only indexed example is dead (fetched https://us-careers.zohorecruit.com/jobs/Careers — "Page does not exist") | none verified | low — not visible in EU tech | skip |
| Kenjo | `{sub}.kenjo.io` per help docs; **no live tenant board surfaced in search** | none verified | low despite DACH positioning | skip (re-check only if kenjo.io URLs appear in the pool) |
| Factorial | no hosted shared-domain tenant pattern found — search surfaces only their own https://careers.factorialhr.com/; product embeds on customer domains | none | n/a for discovery | skip |
| Wellfound (ex-AngelList) | own platform; robots.txt permits crawling with sitemap.xml.gz but blocks `/jobs/` application flows and `?jobId=` params (fetched https://wellfound.com/robots.txt) | no public API | medium reach, US-heavy | park (JS-heavy, anti-bot reputation) |
| Otta | absorbed into Welcome to the Jungle (`app.welcometothejungle.com`) — wttj is already ingested | — | — | skip (covered) |
| Screenloop (AI-native) | no hosted board domain found (searched `hire.screenloop.com` — nothing indexed) | none found | low | skip |

### Top 3 recommendations

**1. nofluffjobs.com — full-catalog JSON in one GET.**
`https://nofluffjobs.com/api/posting` returns the entire live posting list as
JSON, unauthenticated: `postings[]` with id, company name, title, and a
`location` object carrying country code, city, geo, and a `fullyRemote` flag.
Verified 2026-09-02 by curl with a plain browser User-Agent (their WAF blocks
generic fetchers, so the adapter must send a UA header). Poland-centric with
HU/CZ/SK/NL sections, mandatory salary ranges, many English-language postings
— a strong EU relocation source for the cost of one HTTP request per ingest.

**2. Manatal careers-page.com — shared-domain discovery + per-client JSON.**
Client boards live at `www.careers-page.com/{slug}` (fetched:
https://www.careers-page.com/lifelancer), and each has an official public
paginated JSON API:
`https://www.careers-page.com/api/v1.0/c/lifelancer/jobs/?page=1&page_size=5`
returned `{count: 9313, next, results[]}` with position name, HTML
description, and city/country — no auth. Documented at
https://developers.manatal.com/reference/career-page_jobs_list. The pool
already contains unrecognized careers-page.com URLs, so this closes a known
labeling gap and adds a name-probe pattern in one move. Caveat: the tenant
base skews toward recruiting agencies, so per-board quality filtering matters.

**3. huntukvisasponsors.com — the visa-sponsorship board, scrape-friendly.**
Directly matches the user's constraint: every job card carries a
sponsorship-likelihood rating (High/Medium/Low) derived from the gov.uk
sponsor register, "70,600+ live jobs" (fetched
https://huntukvisasponsors.com/jobs). Server-rendered HTML with stable
`/job/{slug}-at-{company}-{id}` URLs; robots.txt (fetched) explicitly allows
job listings while reserving `/api/`. No JSON, so this is an HTML adapter,
but the signal (sponsorship likelihood) exists nowhere else in the pool.

Runner-up: **HR Manager (Talentech)** — the unauthenticated XML positionlist
(`https://api.hr-manager.net/jobportal.svc/regionsyddanmark/positionlist/xml/?incads=1`,
fetched, full ads with apply URLs) is the cleanest feed of the whole scan,
but tenant aliases must be harvested one by one; worth it when Nordic
coverage becomes a priority.

### Checked and not worth it (don't re-tread)

- **justjoin.it API**: `/api/offers` is gone (404 fetched 2026-09-02) and
  `api.justjoin.it` 503s even with a browser UA. The sitemap route
  (robots → `sitemaps/active-jobs.xml` → `part0.xml`, all fetched) is the
  only door; the adapter recommendation above rides on it, not the API.
- **Gem, Dover**: hosted boards exist (`jobs.gem.com/{slug}`,
  `app.dover.com/jobs/{slug}`) but are data-free SPA shells — Dover ships
  Cloudflare Turnstile. US-centric anyway. Fetched both examples.
- **Zoho Recruit**: the documented `{tenant}.zohorecruit.com` portal pattern
  produced zero live EU examples; the one indexed board is dead (fetched).
- **Factorial, Kenjo, Screenloop**: no discoverable hosted-board pattern in
  the wild (Factorial embeds on customer domains; Kenjo's `{sub}.kenjo.io`
  has no indexed tenants; `hire.screenloop.com` doesn't resolve in search).
- **Otta**: merged into Welcome to the Jungle; wttj is already ingested.
- **HiBob**: real pattern (`{tenant}.careers.hibob.com`, fetched
  hibob-e360) but boards are JS shells and the Hiring API requires a service
  user (fetched apidocs). Revisit only with a headless-fetch capability.
- **Jobylon Feed API**: public but keyed by non-guessable per-company hashes
  (fetched https://developer.jobylon.com/feed-api) — useless for discovery.
  The emp.jobylon.com shared domain + its 200-OK sitemap is the open lead.
- **rejobs.org / remoteyeah.com / solid.jobs / duunitori.fi**: all have
  workable sitemaps (fetched each), none clears the bar today — niche
  vertical, tiny volume, redundant with PL boards, and restrictive robots
  respectively.
