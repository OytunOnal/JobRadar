# Source scan: Bulgaria

Scope: Bulgaria only, tech roles, visa-sponsorship bias (issue #31). Every
claim below carries the URL it was fetched from, a verbatim quote where the
payload offered one, and today's date (2026-09-03). Lines are marked
**found** (fetched this run) or **inferred** (deduction from what was
fetched). A page that could not be fetched is reported as *unreachable*,
never filled from memory.

Already covered and out of scope, per the brief: EURES, NoFluffJobs,
justjoin.it, arbeitnow, remotive, remoteok, jobicy, himalayas,
weworkremotely, freehire, workingnomads, themuse, adzuna, jsearch/indeed,
linkedin, and the ~31 ATS discovery adapters. Bulgaria is "the same shape one
size down" from Romania in this sweep, so it got a smaller budget.

## Headline

**No employer-level work-permit register was found — and one candidate host
(`data.egov.bg`) could not be reached at all from this environment, so that
question is open, not closed.** The one register Bulgaria's Employment
Agency does publish turned out to be the wrong shape: a list of licensed
*temp-work/recruitment agencies*, not of employers holding permits for
third-country nationals. On the boards side, three general/tech job sites
(dev.bg, zaplata.bg, jobtiger.bg) all carry sitemap + JSON-LD `JobPosting`
doors with employer names published; Bulgaria's two largest general boards
(jobs.bg, karieri.bg) are Cloudflare-gated and could not be evaluated.

## Findings

| Source | Type | Machine door? | Exact URL fetched | Employer name published? | Visa relevance | Verdict |
|---|---|---|---|---|---|---|
| **data.egov.bg** (open-data portal, work-permit dataset search) | Government open-data portal | **Unverifiable.** Every request (curl with `--ssl-no-revoke` + Chrome UA, Node `fetch` with UA/Accept-Language/Referer headers, and the WebFetch tool) returned an identical `403 Forbidden` body, including on `robots.txt` itself | `https://data.egov.bg/robots.txt` (403); `https://data.egov.bg/api/3/action/package_search?q=разрешения+за+работа` (403) | Unknown | Highest, if it exists | **inconclusive — unreachable**, not skip. Flag for retry from a different network/IP; this is an environment-level block (WAF/geo rule), not a robots directive |
| **chtp-povr.az.government.bg/employment-register** ("Регистър Заетост") | Government register — but of licensed recruitment/temp-work agencies (ЧТП), not employers of third-country nationals | Yes — open, `robots.txt`: `User-agent: *` / `Disallow:` (blank, i.e. fully open) | `https://chtp-povr.az.government.bg/employment-register` (200) | Yes, but for the wrong entity type — "Единен електронен централизиран регистър на физическите и юридическите лица, осъществяващи посредническа дейности и/или осигуряващи временна работа" (register of intermediaries/temp-staffing providers) | Low — wrong register for a permit-holding-employer join | **skip — confirmed not the target register** |
| **az.government.bg** foreigner-employment pages (legal framework, FAQ, EU Blue Card, single-permit procedure) + 4 statistics categories | State employment agency | No employer/permit-holder list anywhere in this section; only aggregate monthly/annual bulletins | `https://www.az.government.bg/bg/ejobs/`, `/pages/zaetost-na-chuzhdenci-normativna-uredba`, `/pages/zaetost-na-shuzdentsi-faq`, `/pages/procedura-usz`, `/pages/visokokvalificirana-zaetost-sinia-karta`, `/stats/1/` through `/stats/4/` (all 200) | n/a | High intent, no employer-level data | **skip — checked exhaustively, no list found** |
| **е-Трудова борса** (az.government.bg national vacancy search) | National public employment service | **No.** POST-driven advanced-search form only (region/municipality/occupation-code dropdowns); no results render without submission. `robots.txt` names `Disallow: /work/` and a `# Sitemap:` line that is commented out (dead); the un-commented sitemap URL 404s | `https://www.az.government.bg/bg/ejobs/view_prl/` (200, "Към 03/09/2026 в бюрата по труда има заявени 11172 свободни работни места" — 11,172 active vacancies quoted from the page); `https://www.az.government.bg/robots.txt` (200); `https://www.az.government.bg/sitemap.xml` and `http://az.government.bg/sitemap.xml` (both redirect chains end in 404) | Unknown — form-gated | High by intent | **skip — no machine door found; already-covered-via-eures for whatever it surfaces** |
| **dev.bg** | Tech-specific board | **Yes.** `robots.txt`: `Disallow: /ит-събития/action~*` plus a `User-agent: JoobleBot` / `Disallow: /` block — **no AI-crawler ban**. Sitemap: `https://dev.bg/wp-sitemap-posts-job_listing-1.xml`, 212,532 bytes, **1,485 job-listing URLs** (counted) | `https://dev.bg/robots.txt` (200); `https://dev.bg/wp-sitemap-posts-job_listing-1.xml` (200); sample `https://dev.bg/company/jobads/kirey-it-solution-specialist-unified-communications/` (200) — JSON-LD `"@type":"JobPosting"`, `"hiringOrganization":{"@type":"Organization","name":"https://dev.bg/company/kirey/","sameAs":"Kirey"}`, `"datePosted":"2026-08-12"` | **Yes** (as `sameAs` + company-slug URL) | Medium-high — tech-only board | **adapter-worthy — top BG pick** |
| **zaplata.bg** | General board | **Yes.** `robots.txt`: `Disallow: /printadvert/`, `Disallow: /search/`, `Sitemap: https://www.zaplata.bg/sitemap.xml` — no AI-crawler bans. Sitemap: `https://www.zaplata.bg/sitemaps/sitemap-ads-1.xml`, 273,710 bytes, **2,301 job-ad URLs** (counted) | `https://www.zaplata.bg/robots.txt` (200); `https://www.zaplata.bg/sitemaps/sitemap-ads-1.xml` (200); sample `https://www.zaplata.bg/pochistvane-i-grizhi-za-doma-ofisa/sofia/699731/kamerier-ka/` (200) — JSON-LD `"@type":"JobPosting"`, `"hiringOrganization":{"@type":"Organization","name":"Галант Лавър ООД", ...}`, `"validThrough":"2026-09-22"` | **Yes** (full JobPosting schema) | Medium — general board, sampled listing was a housekeeping role | **adapter-worthy** (secondary/general) |
| **jobtiger.bg** | General board | **Yes.** `robots.txt`: `Disallow: /jobs`, `Sitemap: https://www.jobtiger.bg/sitemaps/sitemap_jobs_0.xml` (plus others) — and a named **`User-Agent: ClaudeBot` / `Crawl-Delay: 30`** (a rate limit, not a ban; respected, not routed around). Sitemap has **1,382 job URLs** (counted), all under `/obiavi-za-rabota/` — a path robots does not disallow | `https://www.jobtiger.bg/robots.txt` (200); `https://www.jobtiger.bg/sitemaps/sitemap_jobs_0.xml` (200); sample `https://www.jobtiger.bg/obiavi-za-rabota/stazhant-.../327682-2` (200) — JSON-LD `@graph` → `@type:"JobPosting"` with `identifier`, `hiringOrganization.name`, `baseSalary`, `industry`, `jobLocation` | **Yes** | Medium — general board | **adapter-worthy** (secondary/general, respect the 30s crawl-delay) |
| **jobs.bg** | General board, reputed largest in Bulgaria | **Unverifiable — Cloudflare managed JS challenge blocks even `robots.txt`** | `https://www.jobs.bg/robots.txt` (non-200, "Just a moment..." challenge; tried curl+browser UA) | Unknown | Medium-high (scale) | **unreachable, not skip** — real gap given its reputed size |
| **karieri.bg** | General board | **Unverifiable — same Cloudflare managed JS challenge** | `https://www.karieri.bg/robots.txt` (non-200; tried curl+browser UA and WebFetch, both 403) | Unknown | Medium | **unreachable, not skip** |

## Checked, not worth it

- **data.egov.bg** — 403 to every method tried (curl, Node with headers, WebFetch). Unreachable, not confidently skippable — flag for a retry from a different network.
- **www.jobs.bg**, **www.karieri.bg** — Cloudflare managed JS challenge blocks even `robots.txt`. Unreachable.
- **chtp-povr.az.government.bg/employment-register** — real, open register, but of licensed recruitment/temp-work agencies, not work-permit-holding employers. Wrong register for this purpose.
- **az.government.bg/sitemap.xml** — dead; the redirect chain from both `http://` and `https://` ends in a 404.

## Answer to the permit-register question

Not found via any reachable channel. The Employment Agency's own site was
crawled exhaustively (legal-framework pages, FAQ, EU Blue Card page,
single-permit procedure page, and all four statistics categories) and
publishes only aggregate monthly/annual bulletins, never an employer-level
list. The one register that does exist on an Employment-Agency-family host
(`chtp-povr.az.government.bg/employment-register`) is a register of licensed
intermediaries/temp-staffing agencies, not of employers holding third-country
work permits — checked and confirmed the wrong shape by its own on-page
description. Whether `data.egov.bg` (Bulgaria's general open-data portal)
holds such a dataset is a genuinely open question: the host returned `403
Forbidden` to three different fetch methods, including on `robots.txt`
itself, which looks like an environment/WAF-level block rather than a
robots directive — this should be retried before being called a skip.
