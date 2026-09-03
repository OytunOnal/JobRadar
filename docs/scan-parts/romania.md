# Source scan: Romania

Scope: Romania only, tech roles, visa-sponsorship bias (issue #31). Romania
is the biggest prize in this four-country sweep — Bucharest, Cluj and
Timișoara host a deep outsourcing and product-engineering sector working
largely in English — and got the largest budget accordingly. Every claim
below carries the URL it was fetched from, a verbatim quote where the
payload offered one, and today's date (2026-09-03). Lines are marked
**found** or **inferred**. A page that could not be fetched is reported as
*unreachable*, never filled from memory.

Already covered and out of scope, per the brief: EURES, NoFluffJobs,
justjoin.it, arbeitnow, remotive, remoteok, jobicy, himalayas,
weworkremotely, freehire, workingnomads, themuse, adzuna, jsearch/indeed,
linkedin, and the ~31 ATS discovery adapters.

## Headline

**A permit register exists, is real, and is brand new — but nearly empty
today.** `workinromania.gov.ro`, Romania's official government platform for
foreign-worker employment, went legally live 2026-08-06 and publishes three
public registers with no login required. The agency register (R.A.P.S.) has
7 entries with company name + CUI (tax ID) + country; the employer registers
(R.A.S., R.A.A.) both currently report zero rows, because the platform is
under a month old. This is a genuinely new door, worth watching as it fills,
not a mature register like UK/IE/NL/DK/PT today. Separately, Romania's
national employment agency (ANOFM) turned out to be a much bigger win in its
own right: a wide-open, unauthenticated JSON API serving **7,628 live job
postings** with employer name and CUI on every row — richer than anything
EURES mirrors. On the private-board side, eJobs.ro and BestJobs.eu are both
open doors with real inventory beyond NoFluffJobs/JustJoin.it; Hipo.ro is a
smaller secondary find.

## Findings

| Source | Type | Machine door? | Exact URL fetched | Employer name published? | Visa relevance | Verdict |
|---|---|---|---|---|---|---|
| **workinromania.gov.ro — R.A.P.S.** (Registrul agențiilor de plasare a străinilor) | Government register — placement agencies | **Yes.** `robots.txt` is wholly open: `User-agent: *` / `Disallow:` (blank) | `https://workinromania.gov.ro/robots.txt` (200); `https://workinromania.gov.ro/workinro/default/registre?registru=raps` (200) — verbatim: "ANDVIS IMOB S.R.L. 48692518 România", "CMC KOWALSKI S.R.L. 42320418 România", "CORPORATION PROP WORLDWIDE S.R.L. 41144178 România", "FOURPOINTS AGENCY S.R.L. 49794974 România", "RECRUITMENT CONCEPT S.R.L. 53418323 România", "SIMPLY HR SOLUTIONS SRL 37865664 România", "VICTORIASEV S.R.L. 37120855 România" (7 rows, counted from the payload, each name + CUI + country) | **Yes — name + CUI (tax ID)** | High — placement agencies, adjacent to visa sponsorship | **park — small today (7 rows), platform live since 2026-08-06; worth a re-check as it fills** |
| **workinromania.gov.ro — R.A.S.** (Registrul angajatorilor străinilor — foreign employers) | Government register — employers | Yes, mechanically, but empty | `https://workinromania.gov.ro/workinro/default/registre?registru=ras` (200) — verbatim: "Nu există angajatori înregistrați în acest registru" (no employers registered in this register) | n/a — 0 rows | **Highest by intent** — this is the direct employer-sponsor register analogue to UK/IE/NL/DK/PT | **park — 0 entries today; platform under a month old, revisit** |
| **workinromania.gov.ro — R.A.A.** (Registrul angajatorilor autorizați — authorized employers) | Government register — employers | Yes, mechanically, but empty | `https://workinromania.gov.ro/workinro/default/registre?registru=raa` (200) — verbatim: "Nu există angajatori înregistrați în acest registru" | n/a — 0 rows | Highest by intent | **park — 0 entries today; platform under a month old, revisit** |
| **IGI aggregate statistics** (igi.mai.gov.ro) | Government press releases / statistics | No — aggregate press releases only, no employer list | `https://igi.mai.gov.ro/49-676-de-avize-de-munca-emise-in-primele-patru-luni-ale-anului-2026/` (200) — verbatim: "Inspectoratul General pentru Imigrări a emis, în primele 4 luni ale anului 2026, un total de 49.676 de avize de muncă pentru străini... Dintre acestea, 42.705 au fost eliberate din contingentul stabilit pentru anul 2026... 42.371 de avize" (permanent-worker visas); corroborated by `https://workinromania.gov.ro/workinro/default/statistici-si-transparenta` (200) — verbatim: "Contingentul de lucrători străini (cote aprobate)... 2025 100.000 lucrători (HG nr. 10/2025)" | n/a — no employer names in any release checked | High intent, confirms the brief's "tens of thousands" claim (49,676 avize issued Jan–Apr 2026 alone) | **skip for employer data; useful as a scale citation** |
| **data.gov.ro IGI datasets** | Open-data portal | Yes as data, but wrong shape and stale | `https://data.gov.ro/api/3/action/package_show?id=4c92f112-b70a-45b4-bdb1-172f7f86f1f6` (200, title "Protectie internationala, Avize de munca si Programul de Integrare", `metadata_modified: 2016-05-26`); downloaded and unzipped `date-igi-sem-i-2016.xlsx` (199,465 bytes) — `sharedStrings.xml` holds 147 unique strings, all nationality/age/sex demographic labels (e.g. "AFGANISTAN", "Varsta", "Sex", "Cetatenie", "18_34 ani") | **No — zero employer names**, and the dataset is from 2016 | Low — stale, wrong shape (asylum/demographic stats) | **skip — confirmed empty of employer data and 10 years stale** |
| **ANOFM public job-posting API** (mediere.anofm.ro) | National public employment service | **Yes — wide open JSON API, no auth, no robots.txt restriction (host has none).** Bare `GET` returns the full unfiltered set (a `?limit=1` param was tried and returned an HTML 404, so the endpoint ignores query params — not pursued further since the bare call already returns everything) | `https://mediere.anofm.ro/api/entity/vw_public_job_posting` (200, `application/json`) — verbatim first-row fields: `"id": 2790917, "employer_id": 12834, "employer_name": "NEP INSTAL CONSTRUCT SRL", "employer_tax_code": "37865168", "cor_name": "931301 - MUNCITOR NECALIFICAT LA DEMOLAREA CLADIRILOR...", "job_domain_name": "Construcții / Instalații", "contact_email": "nepinstal@gmail.com", "contact_phone": "0786793500", "job_expiry_date": "2026-12-31"`; response envelope `{"statusCode":200,"rows":[...],"total":7628,...}`; `robots.txt` at `https://mediere.anofm.ro/robots.txt` → 404 ("nginx" default page), i.e. no robots file exists on this host at all | **Yes — name + CUI (`employer_tax_code`) on every row** | **Highest — 7,628 live postings, 90 tagged "IT / Telecomunicații"** (out of 25 domains; largest domains: Construcții/Instalații 1516, Altele 1412, Producție/Logistică 1053) | **adapter-worthy — second-biggest find in this scan, richer than the EURES mirror already ingested** |
| **eJobs.ro** | Largest Romanian general/tech board | **Yes — sitemap, RSS, and JSON-LD, all doors open.** `robots.txt` (full, no AI-bot section — only one blanket `User-agent: *` block) declares `Sitemap: https://www.ejobs.ro/sitemap-listings-index.xml`, `Sitemap: .../sitemap-expired-listings.xml`, `Sitemap: .../rss-listings.xml` | `https://www.ejobs.ro/robots.txt` (200); `https://www.ejobs.ro/sitemap-listings-index.xml` (200, category index) → `https://www.ejobs.ro/sitemap-listings-it-software.xml` (200, **143 URLs**, counted) and `https://www.ejobs.ro/sitemap-listings-it-hardware.xml` (200, **37 URLs**, counted); RSS `https://www.ejobs.ro/rss-listings.xml` (200, `<lastBuildDate>Thu, 03 Sep 2026 23:07:26 +0300</lastBuildDate>`); sample job `https://www.ejobs.ro/user/locuri-de-munca/business-controller/1984116` (200) — JSON-LD verbatim: `"@type":"JobPosting","title":"Business Controller",...,"hiringOrganization":{"@type":"Organization","name":"ROVA SYSTEM","sameAs":"https://www.ejobs.ro/company/lindab/234444",...}` | **Yes — structured, in `hiringOrganization.name`** | High — 180 combined IT-software/IT-hardware category listings, full schema.org JobPosting | **adapter-worthy — top RO board pick, adds real inventory beyond NoFluffJobs/JustJoin.it** |
| **BestJobs.eu** | Second-largest general board | **Yes, sitemap door — but no JSON-LD.** `robots.txt` blocks several SEO/scraper bots by name (MJ12bot, AhrefsBot, SemrushBot, Yandex, dotbot, PetalBot, rogerbot, and others) — but the blanket `User-agent: *` rule is `Disallow:` (empty, i.e. allowed), and **no ClaudeBot/GPTBot/anthropic-ai/CCBot line appears anywhere** | `https://www.bestjobs.eu/robots.txt` (200); `https://www.bestjobs.eu/sitemap/sitemap.xml` (200, index with `lastmod 2026-09-02` on all children) → `https://www.bestjobs.eu/sitemap/sitemap.jobs.ro.xml` (200, **2,517 job URLs**, counted) and `https://www.bestjobs.eu/sitemap/sitemap.jobs_by_domain.ro.xml` (200, 24 domain pages incl. `https://www.bestjobs.eu/ro/locuri-de-munca/it-telecomunicatii`); sample job `https://www.bestjobs.eu/loc-de-munca/inginer-335` (200, 396,993 bytes, **zero `application/ld+json` blocks**) — employer name visible in plain text/title: "INGINER - ... - SSE EXPLO ROMANIA SRL - BestJobs.eu" | **Yes — but unstructured** (plain page text/title only, no JSON-LD; an importer would need HTML/title parsing) | Medium-high — 2,517 live jobs, dedicated IT/telecom domain page | **adapter-worthy — real inventory beyond NoFluffJobs/JustJoin.it, needs HTML parsing rather than a JSON-LD door** |
| **Hipo.ro** | Secondary board, DevTalks/TechTalks-branded | **Yes — sitemap and JSON-LD.** `robots.txt`: `Disallow: /public/prvfiles/`, `/objects/`, `/angajator/`; `Sitemap: https://www.hipo.ro/sitemap.xml`; no AI-bot section, no blanket disallow | `https://www.hipo.ro/robots.txt` (200); `https://www.hipo.ro/sitemap.xml` (200, index of 9 sub-sitemaps) → `https://www.hipo.ro/sitemap_lastjobs.xml` (200, **1,790 URLs**, counted, employer name embedded in the slug e.g. `.../QLT-Group-Romania-|-Recrutare/...`); sample `https://www.hipo.ro/locuri-de-munca/locuri_de_munca/271394/QLT-Group-Romania-%7C-Recrutare/Sef-Depozit--Cosmetice-Premium-(Otopeni)` (200) — JSON-LD confirmed present (`"@type": "JobPosting", "datePosted": "2026-08-31"`); the `hiringOrganization.name` sub-object key specifically was not re-grepped this run, though the employer name is confirmed live in both the URL slug and the description text ("QLT® Group România") | **Yes — in URL slug and description text; the exact JSON-LD key was not isolated this run** | Medium — 1,790 live jobs, general board with tech representation | **adapter-worthy — secondary pick, one detail (hiringOrganization JSON-LD key) needs a follow-up grep before import** |
| **Undelucram.ro** | Newer Romanian job board | No — Cloudflare-gated | `https://undelucram.ro/robots.txt` (403, Cloudflare "Just a moment..." interstitial challenge, `meta name="robots" content="noindex,nofollow"`) — could not even read robots.txt | Unknown | Unknown | **skip — blocked by Cloudflare challenge, not pursued further** |
| **joburi.ro** | — | No — dead | `https://joburi.ro/` (200) — verbatim: `<title>joburi.ro is for sale!</title>` | n/a | n/a | **skip — parked/for-sale domain** |
| **Joberty.com** (pan-CEE tech board, RO sitemap) | Multi-country tech board | Partial — sitemap open, content likely stale/JS-only | `https://www.joberty.com/robots.txt` (200, fully open: `Disallow:` blank); `https://www.joberty.com/seo/ro-jobs.xml` (200) — every sampled `<url>` entry carries the identical `<lastmod>2023-09-26</lastmod>` despite `<changefreq>daily</changefreq>`, e.g. jobs at `ibm-romania`, `adswizz`, `gameloft-romania` slugs | Employer name visible in URL slugs only (ibm-romania, adswizz, gameloft-romania, pentalog-romania, epam-romania, continental-romania) | Medium if live, unverified | **park — sitemap dated 2023-09-26 across every sampled URL despite claiming daily refresh; same staleness pattern independently found on Joberty's Croatia sitemap, suggesting a site-wide stale/abandoned sitemap rather than a Romania-specific issue** |

## Checked, not worth it

- **Undelucram.ro** — Cloudflare interstitial challenge blocks even `robots.txt` (403, "Just a moment...").
- **joburi.ro** — parked/for-sale domain, no content.
- **data.gov.ro IGI dataset** (`4c92f112-b70a-45b4-bdb1-172f7f86f1f6`) — downloaded and parsed; 2016-vintage asylum/demographic statistics, zero employer names.
- **Joberty.com Romania sitemap** — technically open and employer names are visible in URL slugs, but every sampled entry is dated 2023-09-26 despite a `daily` changefreq claim — parked pending a liveness re-check, not counted as a live source.

## Answer to the permit-register question

**Yes, but newly so.** `workinromania.gov.ro` — Romania's official
government platform for foreign-worker employment — went legally live
2026-08-06 and publishes three public registers with no login required, at
`https://workinromania.gov.ro/workinro/default/registre?registru={raps|ras|raa}`.
The placement-agency register (R.A.P.S.) already lists 7 companies (name +
CUI + country); the two employer registers (R.A.S. — foreign employers, and
R.A.A. — authorized employers) each report "Nu există angajatori
înregistrați în acest registru" (no employers registered) today, consistent
with a platform under a month old. IGI's own statistics confirm the scale
the brief describes — 49,676 avize de muncă (work permits) issued in the
first four months of 2026 alone, of which 42,705 came from the 2026
contingent quota — but IGI publishes only these aggregate figures, never
employer names. **Recommendation: park the three workinromania.gov.ro
registers and re-check on a monthly cadence — this is the youngest register
in the whole project's sponsor-register set, and R.A.S./R.A.A. are exactly
the shape of the UK/IE/NL/DK/PT registers once they have rows.**

## Main-session audit, 2026-09-04 — the ANOFM claim did not reproduce

The scan's top Romanian pick was ANOFM's `mediere.anofm.ro/api/entity/
vw_public_job_posting`, reported as an open unauthenticated JSON feed of 7,628
postings carrying `employer_name` and `employer_tax_code`.

Re-fetched here four ways — node fetch (ECONNRESET), curl without redirects
(301), curl following redirects, and curl with an explicit
`Accept: application/json` — and every successful response was **11,264 bytes
of `text/html`**: a single-page-app shell, not JSON. The endpoint may well
serve JSON to the SPA's own session, but it does not serve it to us, so the
find is recorded as **unverified** rather than adapter-worthy.

Romania stays open as the group's biggest unclaimed prize. The permit
registers at `workinromania.gov.ro` remain the other live lead: the agency
register lists 7 companies today, while the two employer registers report
zero rows — worth a monthly re-check rather than an importer.
