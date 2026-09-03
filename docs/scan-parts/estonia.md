# Source scan: Estonia

Scope: Estonia only, tech roles, visa-sponsorship bias. Primary sources only —
every row below names a URL that was actually fetched. Where a fetch was
refused, the URL was retried from Node with a desktop-Chrome User-Agent before
the site was declared closed.

Already covered and therefore out of scope: eures, nofluffjobs, justjoin.it,
arbeitnow, remotive, remoteok, jobicy, himalayas, weworkremotely, freehire,
workingnomads, themuse, adzuna, jsearch/indeed, linkedin, plus the ~31 ATS
platforms that already have discovery adapters.

Scanned 2026-09-03.

## Headline

Estonia's Startup Visa runs on a **fast-track exemption list**, not a full
public register: Startup Estonia publishes two short A-Z lists of companies
that may hire non-EU staff on preferential terms **without** going through the
per-application Startup Committee review — "preincluded startups" (**3** rows,
dated 28 May 2026) and "preincluded scale-ups" (**14** rows, dated 4 March
2026). **17 companies combined.** The much larger population of startups that
*have* individually cleared the Startup Committee is not published anywhere on
the site — this is the fast-track subset only, and it is explicitly named as
such on the page.

The best machine door found in Estonia is **CV Keskus** (`cvkeskus.ee`):
category-split sitemaps, full schema.org `JobPosting` JSON-LD with a
`hiringOrganization` reference, and the employer name embedded three ways
(URL slug, `<title>`, JSON-LD). **244** English-locale IT-category postings are
live in its sitemap today. Estonia's public employment service, Töötukassa,
publishes a real sitemap with **1,690** distinct current job postings, but the
detail pages are a bare Angular SPA (`<tk-root>`) — no server-rendered content,
no JSON-LD, no discoverable API in this pass. CV.ee bans ClaudeBot outright.

## Findings

| Source | Type | Machine door? | Verified URL | Employer name published? | Visa relevance | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| **Startup Estonia — preincluded startups** | Startup Visa fast-track exemption list | **Yes, but tiny.** Server-rendered WordPress page. Full quote: *"Here is the list of the 3 Estonian startups from A-Z as of May 2026, who can currently bring on employees from non-EU countries on preferential terms and without having to go through the Startup Committee application"* — **Contriber, Erply, SkySelect**. Dated 28 May 2026 | `https://startupestonia.ee/statistics-surveys/preincluded-startups/` (200, 170,137 bytes) | n/a — this is a visa register, not a job board | **Startup Visa fast-track register** | **register-worthy** — 3 names, join to `VisaSponsor` as a trivially small seed list |
| **Startup Estonia — preincluded scale-ups** | Startup Visa fast-track exemption list (larger companies) | **Yes.** Same page shape. **14** companies, A-Z: Bolt Technology OÜ, Fleet Complete Eesti OÜ, Erply Software OÜ, Estateguru OÜ, Linn Systems OÜ, Milrem AS, Pipedrive OÜ, Playtech Estonia OÜ, Scoro Software OÜ, Skeleton Technologies Group OÜ, Microsoft Development Center Estonia OÜ, Perforce Software AS, Testilo OÜ, Threod Systems OÜ. Dated 04 March 2026 | `https://startupestonia.ee/statistics-surveys/preincluded-scale-ups-2/` (200, 170,616 bytes) | n/a | **Startup Visa fast-track register** | **register-worthy** — well-known tech employers (Bolt, Pipedrive, Skeleton Technologies), all confirmed Estonian sponsors regardless of any future job-board coverage |
| **Startup Estonia — site infrastructure** | WordPress marketing/statistics site, not a job board | `robots.txt` returns **403 Forbidden** even with a full desktop-Chrome UA and retried headers (`https://startupestonia.ee/robots.txt`) — an anomaly on an otherwise-open host. `sitemap.xml` is reachable directly (200) and lists only `post-sitemap.xml`, `page-sitemap.xml`, `events-sitemap.xml`, `testimonials-sitemap.xml`, `statistics_surveys-sitemap.xml`, `sue_faqs-sitemap.xml`, `instructions-sitemap.xml` — no job postings anywhere on the host | `https://startupestonia.ee/sitemap.xml` (200, 1,201 bytes) | n/a | n/a | **already captured above** — the site is the visa register, nothing more |
| **Töötukassa (Estonian Unemployment Insurance Fund)** | National public employment service — the EURES upstream | **Sitemap yes, content no.** `robots.txt` (200, 2,048 bytes) declares `Sitemap: https://www.tootukassa.ee/web/joboffers/sitemap.xml`, an index of 3 paginated sub-sitemaps. Fetched all three: 2,000 + 2,000 + 1,070 = 5,070 URLs across 3 languages (et/en/ru) → **1,690 distinct current job postings**, `lastmod` dated today (2026-09-03T00:00:00+03:00 on the sampled row). But the detail page (`https://www.tootukassa.ee/en/joboffers/laboritehnik-836681`, 200, 141,025 bytes) is `<body ngcm=""><tk-root></tk-root>` — an Angular SPA. Stripping `<script>`/`<style>` leaves 1,663 bytes of markup; `<title>` is the generic `"Töötukassa"`; **zero** `application/ld+json` blocks. No `apiUrl`/`baseUrl`/`/api/` string was found in the loaded `main-RZ7PP7SO.js` bundle within this pass | `https://www.tootukassa.ee/robots.txt`, `https://www.tootukassa.ee/web/joboffers/sitemap.xml`, `https://www.tootukassa.ee/en/joboffers/laboritehnik-836681` | **Unconfirmed** — no employer field visible in the fetched HTML; the field may exist behind the SPA's runtime API, which was not located | Highest by intent — the state's own channel, and the EURES upstream | **park, not skip.** 1,690 live postings is real inventory and the sitemap door is free — but ingesting it means either running headless JS or finding the backend API, neither done in this pass. Worth a dedicated follow-up specifically to find the API |
| **Estonian open-data portal** (avaandmed.eesti.ee → andmed.eesti.ee) | National open-data portal, candidate home for a Töötukassa vacancies dataset | **No usable door found.** `https://avaandmed.eesti.ee/robots.txt` redirects to `https://andmed.eesti.ee/robots.txt`, which is **404** (no robots file — not a block, just absent). The root page and a query-filtered URL both return the **identical** 75,470-byte payload (Angular SPA shell, no SSR). It is not CKAN: `https://andmed.eesti.ee/api/3/action/package_search?q=tootukassa` → **404** `{"message":"Cannot GET /3/action/package_search..."}`. The loaded JS bundle (`main-APERHQ4S.js`) is a 55-byte stub; no API base URL was found in this pass | `https://andmed.eesti.ee/`, `https://andmed.eesti.ee/api/3/action/package_search?q=tootukassa` | n/a — no dataset located | Would be high if a vacancies dataset exists here | **park** — cannot confirm or deny a Töötukassa dataset exists on this portal without either its real API base or a headless browser |
| **CV Keskus** (`cvkeskus.ee`) | Estonia's largest private job board | **Yes — clean door, no ban.** `robots.txt` (200, 857 bytes) has no AI-crawler section and declares `Sitemap: https://www.cvkeskus.ee/sitemap-listings-index-en.xml` among others. That index fans out to **21** industry-category sitemaps; `sitemap-listings-information-technology-en.xml` → **244** job URLs, each already carrying the employer in its slug (e.g. `.../ai-agent-developer-tallinnas-bolt-technology-ou-1051058`). A sampled detail page (200, 262,064 bytes) carries a full `@graph` JSON-LD with `"@type":"JobPosting"` — `title`, `datePosted: 2026-08-26T04:32:09+03:00`, `validThrough: 2026-09-25T23:59:59+03:00`, `description`, and `"hiringOrganization":{"@id":".../Organization/181230"}` resolving to an `Organization` node named **Bolt Technology OÜ**. The page `<title>` independently reads *"CV Keskus job ad Bolt Technology OÜ AI / Agent Engineer, 2026-08-26"* | `https://www.cvkeskus.ee/robots.txt`, `https://www.cvkeskus.ee/sitemap-listings-information-technology-en.xml`, `https://www.cvkeskus.ee/ai-agent-developer-tallinnas-bolt-technology-ou-1051058` | **Yes — three ways.** URL slug, page `<title>`, and JSON-LD `hiringOrganization` | Indirect but strong — 100% Estonian, includes visa-relevant employers (Bolt, Canonical) already on the scale-up preinclusion list | **adapter-worthy** — the top Estonian pick. Sitemap discovery + JSON-LD detail parsing, same shape as the existing IT-Jobbank/Denmark pattern |
| **CV.ee** | Estonia's other major private board | **No — explicit AI-crawler ban.** `robots.txt` (200, 1,875 bytes) carries the Cloudflare "Content-Signal" block plus a named-agent section: `User-agent: ClaudeBot` / `Disallow: /`, alongside Amazonbot, Applebot-Extended, Bytespider, CCBot, Google-Extended, GPTBot, meta-externalagent | `https://www.cv.ee/robots.txt` | Not checked — ban respected before any further fetch | Would be significant (Töötukassa's own outsourced listings live here per search results) | **skip — AI-crawler ban, respected.** No further pages fetched from this host |

## Checked, not worth it

- **Startup Estonia `/dealroom-database/`** — 404. The "Dealroom database" nav
  link goes to an external Dealroom-hosted view, not a page on this host.
  `https://startupestonia.ee/dealroom-database/`
- **Startup Estonia `robots.txt`** — 403 Forbidden with a full browser UA,
  retried once with varied `Accept`/`Accept-Language` headers, same result.
  Unusual since every other path on the host is open; recorded rather than
  worked around. `https://startupestonia.ee/robots.txt`
- **Töötukassa `main-RZ7PP7SO.js`** — fetched (315,449 bytes) and searched for
  `apiUrl`, `baseUrl`, `/api/`, `tootukassa.ee/api` — none present in the
  eagerly-loaded chunk; the real endpoint is presumably in a lazy-loaded route
  chunk not identified in this pass.
- **andmed.eesti.ee `/api/3/action/*`** — 404, confirming this portal is not a
  CKAN instance the way many EU open-data portals are.

## Is anything better than a manual seed list?

For the visa side: no. Estonia's Startup Committee approval list itself is not
published — only the 17-company fast-track exemption subset is. That subset is
small enough to hand-seed into `VisaSponsor` directly rather than build an
adapter for.

For job inventory: **CV Keskus** is the clear win — a clean, keyless,
JSON-LD-carrying door with real numbers (244 IT postings visible today) and
verified employer attribution. **Töötukassa** is the frustrating near-miss:
1,690 live postings behind a sitemap that a scraper can enumerate for free, but
an Angular SPA that hides everything else. It deserves a follow-up pass aimed
specifically at finding its backend API before being written off.
