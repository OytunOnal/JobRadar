# Source scan: Finland

Scope: Finland only, tech roles, visa-sponsorship bias. Primary sources only —
every row below names a URL that was actually fetched. Marketing copy and
third-party "best job boards" listicles were not accepted as evidence. Where a
`WebFetch` was refused, the URL was retried from Node with a desktop-Chrome
User-Agent before the site was declared closed.

Already covered and therefore out of scope: duunitori, thehub, eures, arbeitnow,
remotive, remoteok, jobicy, himalayas, weworkremotely, freehire, workingnomads,
themuse, adzuna, jsearch/indeed, linkedin, and the ~30 ATS platforms that
already have discovery adapters.

Scanned 2026-09-03.

**Headline: Finland's private board tier has collapsed.** Two of the three names
on the brief are gone (Oikotie Työpaikat shut down; Monster.fi is now jobly.fi
behind Cloudflare), a third redirects to an ATS vendor's marketing site, and the
fourth has outsourced its portal. The public tier is real but pipes its
inventory into EURES, which we already ingest.

## Findings

| Board / source | Type | Machine door? | Verified URL | Visa relevance | Verdict |
| --- | --- | --- | --- | --- | --- |
| **Työmarkkinatori / Job Market Finland** | Official national employment platform (KEHA-keskus / ELY) | **Partly — and robots forbids the part that works.** `https://tyomarkkinatori.fi/robots.txt` (200, `text/plain`, `Last-Modified: Thu, 26 Sep 2024`) opens with `User-agent: *` / **`Disallow: /api/`** / **`Disallow: /*/api/`**. The gateway behind that ban is genuinely keyless — `https://tyomarkkinatori.fi/api/codes/v1/koodistot` returns **200 JSON** (a codelist array: `LAIMINLYONTI_TYYPPI`, `PALKKAHAITARI`, …). But no job-search path was found: `/api/tyopaikat/v1/tyopaikat`, `/api/tyopaikat/v2/haku`, `/api/jobads/v1/search`, `/api/tpt/v1/tyopaikat`, `/api/tyopaikkailmoitukset/v1`, `/api/tyopaikkahaku/v1/haku` all returned **404 `default backend - 404`**. There is no sitemap (`https://tyomarkkinatori.fi/sitemap.xml` → **404**, served as the CMS 404 page). The listing page `https://tyomarkkinatori.fi/en/personal-customers/vacancies` (200, 169 KB) is a **Magnolia CMS shell with zero SSR job data** — the jobs render from a client widget declared as `<div id="TmtTyopaikkaHakuV2" … data-widget-path="/widgets/TmtTyopaikkaHakuV2/" data-codes="noprefix:/api/codes/v1/koodistot">`, and `/widgets/TmtTyopaikkaHakuV2/` plus `/asset-manifest.json` both **404** ("TMT static"). The **official** door is authenticated: `https://tyomarkkinatori.fi/en/instructions-and-support/interfaces/interfaces-for-job-postings` documents a REST *retrieval* interface (noutorajapinta) using **Microsoft Identity client-credentials**, with credentials issued by KEHA-keskus after an activation form (`https://tyomarkkinatori.fi/en/dam/jcr:6193a157-9813-4e92-88b4-199f57edfda0/noutorajapinta-ohje-en.pdf`) | **High** — this is where employers must post to reach international recruitment channels | **park — but it is the only real Finnish door.** Two blockers: robots bans `/api/`, and the credentialled API needs a KEHA-keskus application. Worth applying for. Note the inventory itself already reaches us (next row) |
| **Work in Finland** (Business Finland / Talent Boost) | Official international-talent portal | **Yes for the site, no for the jobs.** `https://www.workinfinland.fi/…` 302s to `https://www.workinfinland.com/`. `https://www.workinfinland.com/robots.txt` (200) is fully permissive: `User-agent: * / Allow: /`, plus three sitemaps. `https://www.workinfinland.com/sitemap.xml` (200, 215,867 bytes, **358 `<loc>`s**: 84×3 `/{fi,en,sv}/tyonantajat/`, 17 `/en/why-finland`, 12 `/en/get-started`, 26 `/en/events`, and only **5** under `/en/open-jobs/`). It even ships `/en/llms.txt` and `/en/llms-full.txt`. But `https://www.workinfinland.com/en/open-jobs/` (200, 2,085,520 bytes) renders **"0 jobs available"** server-side, and `/en/open-jobs/find-a-job-in-finland/` (200, 2,089,139 bytes) strips to nothing but chrome — the widget is client-side and no API host appears anywhere in the markup | **Highest by intent.** The page carries the sponsorship rule verbatim: *"If you're from a non-EU country, your chances of getting a job in Finland may be affected by labour market testing… **A residence permit for a specialist is not subject to labour market testing.**"* | **already-covered-via-eures.** The site states its own plumbing: jobs *"published on the Job Market Finland… will be transferred to the Work in Finland website and [eures.europa.eu]"*. Työmarkkinatori → Work in Finland → EURES. We already ingest the last link in that chain |
| **Oikotie Työpaikat** | Was one of Finland's two biggest private boards | **No — the board is shut down.** `https://tyopaikat.oikotie.fi/` (200, 17,459 bytes) is a static farewell page whose visible text reads **"Oikotie Työpaikat on sulkeutunut"** ("Oikotie Työpaikat has closed") — *"Suuret kiitokset kaikille työnhakijoille, yrityksille ja kumppaneille näistä upeista vuosista"*. `https://tyopaikat.oikotie.fi/robots.txt` **redirects to the root** (no robots file at all). `https://www.oikotie.fi/tyopaikat` → **302 to `/404`**. The footer additionally forbids scraping: *"Säännöllinen, järjestelmällinen tai jatkuva tietojen kerääminen… ei ole sallittua ilman Oikotien antamaa kirjallista lupaa"* | n/a — no inventory | **skip — dead.** Copyright line reads ©1999–2025 |
| **Monster.fi** | Was the other big private board | **No.** `https://www.monster.fi/robots.txt` **302s to `https://www.jobly.fi/robots.txt`**, which answers **HTTP 403** with a Cloudflare `Just a moment…` interstitial (retried with a desktop-Chrome UA). Monster Finland is now Jobly, and Jobly will not serve its own robots file to us | Would be high (volume), unreachable | **skip** |
| **Rekrytointi.com** | Was a Finnish job board | **The board is gone; an ATS is behind it.** `https://www.rekrytointi.com/robots.txt` **302s to `https://laura.fi/robots.txt`** (200, 115 bytes, permissive: `User-agent: * / Allow: /`, three narrow disallows). `https://laura.fi/` and `/en/` (200, ~74–76 KB) are a **WordPress marketing site for LAURA Rekrytointi**, a Finnish ATS vendor — not a job board. The robots file itself leaks the tenant ad-URL shape: `Disallow: /*/optofidelity/sales-manager/76889*`, i.e. `…/{tenant}/{job-slug}/{id}` | None directly | **park — as an ATS registry lead, not a board.** LAURA is a Finnish ATS that is **not** in our 30-platform registry. Worth a footprint-driven discovery adapter alongside the existing ones |
| **Aarresaari** (Finnish university career network) | University graduate/trainee portal | **Open, but the jobs are not here.** `https://www.aarresaari.net/robots.txt` (200, permissive WordPress, three sitemaps declared). `https://www.aarresaari.net/sitemap.xml` (200, 13,331 bytes, *"Sitemap is generated on 2026-09-02"*) holds **94 `<loc>`s and not one job URL** — every entry is editorial (`/blogi/`, `/uutiset/…`, `/tapahtumat/…`, `/uraseuranta…`). The network moved its portal out: sitemap entries include `/etusivu/julkaise-opiskelijoiden-tyo-ja-harjoittelupaikat-aarresaaren-jobteaserissa/` ("publish student jobs in Aarresaari's **JobTeaser**") and `/uutiset/yksi-yhteinen-tyopaikkaportaali-koko-aarresaari-verkostolle/` ("one shared job portal for the whole Aarresaari network") | Low — graduate/trainee skew | **skip — see JobTeaser** |
| **JobTeaser** (Aarresaari's portal; also owns Graduateland) | Pan-European graduate board | **Index open, content walled.** `https://assets-cf.jobteaser.com/sitemaps/sitemap.xml` (200) indexes 7 sitemaps; the five `job_ads_sitemap*.xml` files together hold **24,705 job URLs**, `lastmod` **2026-09-03T00:20** (same day). `https://www.jobteaser.com/robots.txt` (200) allows `/*/job-search/*` and `/*/job-offers?locale=*` but blanket-disallows `/*?*`. Then it fails on contact: a sitemap job URL returns **HTTP 403 "JobTeaser \| Security checkup"** in both `/en/` and `/de/` locale form, with full desktop-Chrome headers (UA, Accept-Language, Sec-Fetch-*, Upgrade-Insecure-Requests), and `https://www.jobteaser.com/en/job-search` → **404**. Zero JSON-LD recoverable | Low — internships and graduate roles | **skip** — an open index onto a locked room, and the wrong seniority band besides |
| **Talented.fi** | Finnish tech-talent brand | **Open, but it is not a board.** `https://www.talented.fi/robots.txt` → `https://talented.fi/robots.txt` (200, Yoast, `Disallow:` — nothing blocked). `https://talented.fi/sitemap_index.xml` (200) lists **10 sub-sitemaps** — `post`, `page`, `tal-event`, `tal-story`, `category`, `post_tag`, `author` — and **no job post-type at all**. `https://talented.fi/jobs` → **404**, served `noindex` | None | **skip** — a community/events site, not an inventory |
| **Rekrytori.fi** | The "Rekrytori for internationals" fair linked from Work in Finland | **Open, and empty.** `https://www.rekrytori.fi/robots.txt` → `https://rekrytori.fi/robots.txt` (200, Yoast, permissive). `https://rekrytori.fi/sitemap_index.xml` (200) lists **5 sub-sitemaps** (`post`, `page`, `category`, `post_tag`, `author`) — **no job post-type** | None | **skip** — a career-fair site |
| **Migri** (Finnish Immigration Service) | The visa authority | **No — Cloudflare.** `https://migri.fi/robots.txt` → **403** `Just a moment…` from Node with a desktop-Chrome UA, and `https://migri.fi/en/fast-track-instructions-for-employers` → **403** via WebFetch. The register does not exist anyway (see below) | Would be highest | **skip — closed, and there is nothing behind it to take** |
| **Duunitori** | Already ingested | **Regression worth flagging.** `https://duunitori.fi/robots.txt` now returns **HTTP 403** with a Cloudflare `Just a moment…` interstitial — we can no longer even read its robots file, let alone confirm the AI-crawler posture the existing adapter assumes | n/a | **already-covered — but recheck the adapter.** If the search endpoint is behind the same challenge, that adapter is silently dead |

## Does Finland have a certified-employer register? No.

This was the highest-value hypothesis in the brief, and it fails. Finland's
fast track is **per application, not per employer**, so there is no list to
harvest:

- Migri's own pages are Cloudflare-blocked to us (403 on `robots.txt` from
  Node with a browser UA, 403 on `/en/fast-track-instructions-for-employers`
  via WebFetch), so nothing was taken from them as evidence.
- What the mechanism actually is, per the Work in Finland page we *did* fetch:
  eligibility turns on the **role and salary of the individual application**
  (specialist permits are exempt from labour market testing), not on any
  employer accreditation. The employer's only duty is procedural — logging into
  Enter Finland for Employers and adding the terms of employment within two
  working days of each application.
- **Business Finland / Talent Boost publishes no employer register.**
  `https://www.businessfinland.fi/robots.txt` (200) is fully permissive with a
  sitemap declared, so nothing is hidden from us; there is simply no list.
  `https://www.businessfinland.fi/en/for-finnish-customers/services/talent-boost`
  → **404**.

So there is no Finnish analogue of Denmark's SIRI list or Ireland's DETE
register. `VisaSponsor` gains nothing from Finland.

## Answers to the three questions

**1. Biggest tech-relevant private boards.** They are gone or walled.
**Oikotie Työpaikat** publishes its own obituary ("on sulkeutunut").
**Monster.fi** is now **Jobly.fi** behind a Cloudflare challenge that refuses
even `robots.txt`. **Rekrytointi.com** redirects to **laura.fi**, which is an
ATS vendor's WordPress site, not a board. **Aarresaari** has outsourced its
portal to **JobTeaser**, whose 24,705-URL sitemap is open but whose job pages
answer 403 "Security checkup". **Talented.fi** and **Rekrytori.fi** are open
and permissive but have no job post-type in their sitemaps at all. That leaves
**Duunitori**, which we already ingest — and whose robots file now 403s, which
is worth checking before assuming the adapter still runs.

**2. Public/official beyond what we ingest.** **Työmarkkinatori** does publish
an API, but not an open one: the retrieval interface is REST over Microsoft
Identity client-credentials, issued by KEHA-keskus on application. The
unauthenticated `/api/` gateway is real (the codelist endpoint returns 200
JSON) but `robots.txt` bans `/api/` outright and no job-search path exists
under it; the vacancy page is a CMS shell with no SSR job data and there is no
sitemap. More important than any of that: **Work in Finland states in its own
copy that Työmarkkinatori postings are transferred to Work in Finland and to
eures.europa.eu**. We already ingest EURES, so the Finnish public inventory
already reaches us — a Työmarkkinatori adapter would buy freshness and field
depth, not new jobs.

**3. Visa/relocation boards and employer registers.** Finland has none of the
former and none of the latter. No certified-employer list exists (fast track is
per application), Business Finland publishes no Talent Boost employer roster,
and Migri is behind Cloudflare. The only visa-shaped asset Finland offers is the
rule itself — specialist permits are exempt from labour market testing — which
is scoring logic, not a feed.

## Checked, not worth it

- **Oikotie Työpaikat** — shut down; the site says so, and `oikotie.fi/tyopaikat`
  302s to `/404`. `https://tyopaikat.oikotie.fi/`
- **Monster.fi / Jobly.fi** — 302 then Cloudflare 403 on `robots.txt` with a
  desktop-Chrome UA. `https://www.monster.fi/robots.txt`
- **Rekrytointi.com** — the board no longer exists; 302s to the LAURA ATS
  marketing site. Kept only as an ATS-registry lead. `https://laura.fi/robots.txt`
- **Aarresaari** — permissive robots, 94-URL sitemap, zero job URLs; portal
  moved to JobTeaser. `https://www.aarresaari.net/sitemap.xml`
- **JobTeaser** — 24,705 job URLs in an open sitemap, every job page 403
  "Security checkup", `/en/job-search` 404.
  `https://assets-cf.jobteaser.com/sitemaps/sitemap.xml`
- **Talented.fi** — no job post-type in a 10-sitemap index; `/jobs` 404 and
  `noindex`. `https://talented.fi/sitemap_index.xml`
- **Rekrytori.fi** — career-fair site, 5 sub-sitemaps, no job post-type.
  `https://rekrytori.fi/sitemap_index.xml`
- **Business Finland Talent Boost** — permissive robots, no employer register,
  service page 404. `https://www.businessfinland.fi/robots.txt`
- **Migri** — Cloudflare 403 on `robots.txt` from Node and 403 via WebFetch; and
  there is no certified-employer list behind it to want.
- **avoindata.fi CKAN** — `https://www.avoindata.fi/data/api/3/action/package_search?q=työpaikkailmoitukset`
  returns **HTTP 403** (nginx), so the national open-data portal could not be
  queried at all.
