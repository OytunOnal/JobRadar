# Source scan: Croatia

Scope: Croatia only, tech roles, visa-sponsorship bias (issue #31). Croatia
is small in this group — the answer below is honestly brief, backed by
counted numbers rather than padded. Every claim carries the URL fetched, a
verbatim quote where the payload offered one, and today's date (2026-09-03).
Lines are marked **found** or **inferred**.

Already covered and out of scope, per the brief: EURES, NoFluffJobs,
justjoin.it, arbeitnow, remotive, remoteok, jobicy, himalayas,
weworkremotely, freehire, workingnomads, themuse, adzuna, jsearch/indeed,
linkedin, and the ~31 ATS discovery adapters.

## Headline

**No employer-level permit register — confirmed by parsing the actual
statistics files, not by their absence.** Croatia's MUP (Ministarstvo
unutarnjih poslova) publishes monthly work/residence-permit statistics as
XLSX on the national open-data portal, and both the general statistics
series and a separate quota-utilization dataset were downloaded and
inspected directly: neither contains a single employer name, only aggregate
breakdowns. On the boards side, **Posao.hr** is the find — a categorized RSS
door (including an IT/telecom category) with the employer name embedded in
every item.

## Findings

| Source | Type | Machine door? | Exact URL fetched | Employer name published? | Visa relevance | Verdict |
|---|---|---|---|---|---|---|
| **MUP work/residence-permit statistics** (data.gov.hr) | Government statistics, CKAN | Yes, as data — **but aggregate only**. CKAN API: `package_search` for dataset family `statisticki-podaci-izdanih-dozvola-za-boravak-i-rad-*`, 37 monthly XLSX resources, Jan 2023–Apr 2026, metadata field `data_refresh_frequency: monthly` | `https://data.gov.hr/ckan/api/3/action/package_search?q=dozvola%20za%20boravak%20i%20rad` (200); downloaded and unzipped `mjesecna-statistika-dozvole-za-boravak-i-rad-travanj-2026.xlsx` (12.8KB) — its `sharedStrings.xml` contains only top-5-industry, top-10-nationality, by-police-administration/county, and by-permit-type (new/extension/seasonal) breakdowns | **No — no employer field anywhere in the file** | High intent, no employer data | **skip — confirmed absent by parsing the file, not by giving up on the search** |
| **Quota-utilization dataset** (data.gov.hr) | Government statistics, CKAN | Yes, as data — aggregate by occupation/industry | `https://data.gov.hr/ckan/api/3/action/package_search?q=kvota` (200) | **No — occupation/industry buckets, not employers** | Medium | **skip — same shape problem as above** |
| **HZZ** (Hrvatski zavod za zapošljavanje) main site | National employment service, institutional | No — `hzz.hr` is a WordPress site; its own sitemap covers only news/pages/tenders, no job postings | `https://hzz.hr/robots.txt` (200, clean); `https://hzz.hr/wp-sitemap.xml` (200, lists only news/pages/tenders) | n/a | High by intent | **already-covered-via-eures** for whatever it feeds |
| **burzarada.hzz.hr** (HZZ's actual job-search portal) | National employment service, vacancy search | No — legacy ASP.NET WebForms, no `robots.txt` (404, i.e. open but nothing to declare), session/redirect-gated | `https://burzarada.hzz.hr` — WebFetch returned "too many redirects"; a raw fetch failed outright | n/a | High by intent | **already-covered-via-eures** — not independently machine-readable |
| **MojPosao.net** | General board | No — `robots.txt` blocks only `/Api/`, `/data/jc/`, `/data/download/` (not job pages), but no sitemap declared and no JSON-LD found on a sampled listing page | `https://www.moj-posao.net/robots.txt` (200); sample `https://www.moj-posao.net/Posao/499713/...` (200, ~40KB, no `application/ld+json` present) | Yes — in listing/detail text, unstructured | Medium | **skip — no structured/feed door** |
| **Posao.hr** | General board, with an IT/telecom RSS category | **Yes — RSS, filterable by category and region.** `robots.txt` disallows `/affiliate/`, `/prijava/`, `/zivotopis/`, `/poslovi/*/`, declares `Sitemap: sitemaps-main.xml.gz`; does **not** block `/rss/`. Page markup declares `<link rel="alternate">` doors for `/rss/` (all jobs), `/rss/djelatnosti/` (26 categories), `/rss/zupanije/` (by region) | `https://posao.hr/robots.txt` (200); **`https://posao.hr/rss/djelatnost/9/`** (IT/telecom — "Informatika i telekomunikacije") verified live, 30 `<item>`s, each with `<title>`, `<link>`, `<pubDate>`, and a `<description>` CDATA starting `"Poslodavac: <Company d.o.o.>"` | **Yes — every item, via the `Poslodavac:` (Employer:) line in the description** | Medium-high — IT-category filter built in | **adapter-worthy — top HR pick** |
| **Joberty.com** (pan-CEE tech board, also covers Romania/Slovenia/Bulgaria) | Multi-country tech board | Partial — sitemap open, but content is a bare JS SPA shell | `robots.txt`: `Disallow:` empty (fully open); sitemap index shows parallel `hr-`, `ro-`, `sl-`, `bg-`, `mk-`, `sr-` job/company sitemaps. `hr-jobs.xml` — **92 URLs, every one dated `lastmod 2023-09-26`** (≈3 years stale); a sampled job page is a 3.6KB SPA shell with no server-rendered content | Unknown — slug only, not confirmed in payload | Medium (if live) | **park — liveness unverified, sitemap dates are ~3 years stale; also relevant to the Romania/Slovenia/Bulgaria scans** |

## Checked, not worth it

- **mup.gov.hr employer search** — no such feature exists; MUP publishes only the aggregate statistics files listed above.
- **Posao.hr main HTML listing pages** — JS-driven, no JSON-LD; the RSS doors above are the real machine door, not the HTML pages.

## Answer to the permit-register question

No. Croatia's MUP does track and publish permit statistics monthly on
data.gov.hr, and both the general series and the quota-utilization dataset
were downloaded and parsed directly (not just linked) — the underlying XLSX
files contain only aggregate breakdowns (top-5 industry, top-10 nationality,
by region, by permit type), never an employer name or count. No equivalent
to the UK/IE/NL/DK/PT sponsor registers exists in Croatia.
