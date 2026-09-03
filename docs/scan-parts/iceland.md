# Source scan: Iceland

Scope: Iceland only, tech roles, visa-sponsorship bias. Primary sources only —
every row below names a URL that was actually fetched. Where a `WebFetch` was
refused, the URL was retried from Node with a desktop-Chrome User-Agent before
the site was declared closed.

Scanned 2026-09-03.

## Read this first: the market is thin, and here is the measurement

This scan is deliberately short, because Iceland is small and the numbers say so
plainly rather than by impression:

- **Alfreð**, the dominant private board, reports `totalCount: 710` open jobs
  **nationwide**, and its own category counter reads
  **"Information technology (19)"**.
- **Starfatorg**, the entire government's vacancy portal, returns **156**
  vacancies, of which the field-of-work breakdown gives
  **`Tæknistörf` (technical jobs): 1**, and **zero** titles match any tech
  keyword (`tölv|upplýsingat|hugbúnað|forrit|gagna|develop|softw|data`).
- **Tvinna** has 1,697 job URLs in its sitemap but only **29** carry a 2026
  `lastmod`.

So the honest ceiling for Iceland is roughly **20–40 live tech postings at any
moment**. One cheap adapter is proportionate. Anything more is not, and the rest
of this document is written to justify stopping rather than to pad.

The single most useful Icelandic artefact found is not a feed at all: it is the
government's own enumeration of the Icelandic job market, at
`https://work.iceland.is/working/job-hunting/`, which names every board worth
knowing. Every board listed there was fetched below.

## Findings

| Board / source | Type | Machine door? | Verified URL | Visa relevance | Verdict |
| --- | --- | --- | --- | --- | --- |
| **Alfreð (alfred.is)** | The dominant Icelandic job board | **Yes — SSR, no API needed, and robots-legal.** `https://alfred.is/robots.txt` (200, 157 bytes): `User-agent: *` / `Allow: /*` / **`Disallow: /api/*`** / `Disallow: *jobtypes=*` / `*tags=*` / `*zips=*` / **`*cat=*`**, sitemap declared. The sitemap is useless — `https://alfred.is/sitemap.xml` (200, 285 bytes) points only at `https://alfred.is/sitemap-web.xml` (200, 602 bytes, **6 `<loc>`s**, all marketing: `/vinnustadir`, `/fyrirtaeki`, `/namskeid`, `/appid`, `/um-alfred`, `adstod.alfred.is`) — **zero job URLs**. The real door is the page itself: `https://alfred.is/en` (200, **625,034 bytes**) embeds `<script id="__NEXT_DATA__">` (292,713 bytes) whose `props.pageProps.jobs` holds **27 complete job objects** plus **`totalCount: 710`**, **`totalPages: 27`**, and `jobsInfo: {newToday, newYesterday: 89, summerJobs: 7}`. Each job carries `id, slug, title, published, deadline, expired, created, description, bodyhtml, employmentType, jobTypes[], addresses, brand{name, logo, slug}, jobCompensations, applyType, originalLanguage, translated`. Sibling `props.pageProps.categories` gives live counts — Service 225, Industry 191, Healthcare 124, Professionals 117, Teaching 89, Sales 73, Management 72, Food 68, Office 48, **Information technology 19**. Detail pages render too: `https://alfred.is/en/starf/junior-frontend-engineer-customer-facing` (200, 26,869 bytes). **The cap:** `?page=2` does **not** paginate server-side (identical first slug to page 1), and `https://alfred.is/en/upplysingataekni` → **404**, so the other 26 pages and the IT filter are reachable only through `/api/`, which robots bans | Moderate — the board is bilingual and carries an `originalLanguage`/`translated` flag, which is a usable proxy for English-speaking, foreigner-open roles | **adapter-worthy — top IS pick, but scoped.** One keyless fetch of `/en` yields the 27 freshest jobs with full descriptions, plus the national and IT totals for free. Run it often rather than deeply: at 89 new jobs/day and 27 per page, a daily-or-better poll of page 1 sees most of the flow without ever touching the banned API |
| **Starfatorg / island.is** | The government's vacancy portal (and now Vinnumálastofnun's) | **Yes — a public, keyless GraphQL API.** `https://www.starfatorg.is/` **302s to `https://island.is/starfatorg`** (200, 968,004 bytes) whose `__NEXT_DATA__` apolloState is typed `IcelandicGovernmentInstitutionVacancyListItem`. That query runs unauthenticated: **POST `https://island.is/api/graphql`** with `query{icelandicGovernmentInstitutionVacancies(input:{}){vacancies{id title institutionName fieldOfWork applicationDeadlineFrom applicationDeadlineTo intro logoUrl}}}` → **200, 193,617 bytes, 156 vacancies** with full `intro` text and dd.mm.yyyy deadlines. Introspection is disabled (`INTROSPECTION_DISABLED`) but the server **validates field names**, which is how the shape above was recovered — an early wrong guess returned `Cannot query field "total" on type "IcelandicGovernmentInstitutionVacanciesResponse"`. `https://api.island.is/api/graphql` → 404; the door is on the web host. **`https://island.is/robots.txt` → 404** — island.is publishes no robots file at all, so there is no ban, and equally no explicit permission. Vinnumálastofnun folds in here: `https://www.vinnumalastofnun.is/storf-i-bodi/` **302s to `https://island.is/s/vinnumalastofnun/laus-storf`**, and `https://vinnumalastofnun.is/robots.txt` 302s into `island.is/redirects/…` | Public sector, Icelandic-language, Icelandic-qualification heavy — low sponsorship likelihood | **park — the cleanest API in this scan, attached to the wrong inventory.** 156 rows, `Tæknistörf: 1`, zero tech-keyword title matches. Field breakdown: Heilbrigðisþjónusta 103, Önnur störf 18, Sérfræðistörf 12, Kennsla og rannsóknir 10, Stjórnunarstörf 4, Löggæslustörf 3, Skrifstofustörf 3, Sumarstörf 2, Tæknistörf 1. Costs almost nothing to add later if Iceland ever matters more |
| **Tvinna.is** | Icelandic job board | **Yes, fully open — and mostly an archive.** `https://tvinna.is/robots.txt` (200, 22 bytes): `User-agent: *` / `Allow: /` — no restrictions at all. `https://tvinna.is/sitemap.xml` (200, 290,368 bytes) holds **1,699 `<loc>`s, 1,697 of them `/jobs/{slug}`**, each with `<lastmod>` — but only **29 are dated 2026**. Slugs do include real tech (`junior-frontend-engineer-customer-facing`, `software-quality-assurance-engineer-5`, `data-product-manager-vorustjori-gagna`, `appforritari`) alongside `massage-therapist` | Low | **park.** The most permissive door in Iceland, opening onto ~29 live rows. Cheap enough to revisit; not worth building for now |
| **Störf.is** | Icelandic aggregator ("Öll atvinna og störf auglýst á einum stað") | **Partly — SSR, but it links out.** `https://www.storf.is/` (200, 303,376 bytes, Next.js app router) renders job cards server-side with titles and description text. **No robots.txt** (`https://www.storf.is/robots.txt` → 404, served as the SPA shell) and **no JSON-LD**. Crucially the cards' anchors point **off-site to the employer's own page** — e.g. `href="https://hi.is/lausstorf#Lektor-í-stærðfræði-og-stærðfræðimenntun"` — so it is a signpost, not a store. Facet paths are clean: `/flokkur/{slug}` (`heilbrigdisthjonusta`, `stjornendastorf`, `kennsla`, …), plus `/landssvaedi`, `/fyrirtaeki` | Low | **park.** An aggregator whose value is the outbound links; would need bespoke HTML parsing for a market this size |
| **Job.is** | Icelandic job board | **No — a bot wall.** `https://www.job.is/robots.txt` and `https://www.job.is/` both return **HTTP 429** with a **"Vercel Security Checkpoint"** page, from Node with a desktop-Chrome UA. It is also **absent from the government's own list** of Icelandic job sites | n/a | **skip** |
| **mbl.is/atvinna** | Morgunblaðið's job section | **No — Cloudflare.** `https://www.mbl.is/atvinna/` → **HTTP 403**, `Just a moment…` challenge, retried with a desktop-Chrome UA | n/a | **skip** |
| **HH Ráðgjöf (hhr.is)** | Icelandic recruitment agency with a job site | **Yes, technically.** `https://hhr.is/robots.txt` → **200 `text/plain`, zero bytes** — an empty file, so nothing is disallowed. `https://hhr.is/` (200, 311,277 bytes) is SSR ("Laus störf \| www.hhr.is … Atvinnuappið - HH Ráðgjöf"), no JSON-LD | Low | **skip** — an agency site inside a market whose *dominant* board carries 19 IT jobs |
| **Northstack.is** | Icelandic tech/startup publication | **No board.** `https://northstack.is/jobs` → **404** (Ghost site, `https://www.northstack.is/jobs/`) | n/a | **skip** |
| **work.iceland.is** (Work in Iceland, official) | Government relocation portal | **Yes — and it is the market map, not a feed.** `https://work.iceland.is/robots.txt` (200, 99 bytes): `User-agent: *` / `Allow: /`, sitemap declared. `https://work.iceland.is/sitemap.xml` (200, 286 bytes) → a single `sitemap-pages.xml`, `lastmod 2026-05-28`. `https://work.iceland.is/working/job-hunting/` (200, 282,350 bytes, Gatsby SSR) enumerates the whole Icelandic market by outbound link: **alfred.is, hhr.is, mbl.is/atvinna, northstack.is, reykjavik.is/laus-storf, stjornarradid.is (Starfatorg), storf.is, tvinna.is, vinnumalastofnun.is/storf-i-bodi, eures.europa.eu**, plus recruiters **bru-talent.is, hagvangur.is, intellecta.is, radum.is, swappagency.com** | **Highest available for Iceland** — it is the state's own advice to foreign workers | **skip as a feed, keep as the primary source.** It publishes no vacancies of its own; its value is that it settles the market map and the permit question below |

## Iceland's visa side: no register exists, and the reason is structural

The brief asked about "work-permit employer patterns". The answer comes straight
from the government's own page (`https://work.iceland.is/working/job-hunting/`,
fetched, 200):

> "Work permits are applied for before or after arriving in Iceland… you must
> not start employment before receiving the necessary work permit. **Work
> permits are non-transferable and only valid with the employer**"

That is the whole pattern. Icelandic permits are **tied to a specific employer
and issued per application** — there is no certification, no pre-approval, and
therefore **no employer register to harvest**. Iceland contributes nothing to
`VisaSponsor`. The same page's practical advice is telling about what actually
works in a market this size:

> "Since Iceland is such a small country, identifying the companies that match
> your skill set is often worth identifying. Usually, it is best to contact them
> directly, follow their website for job notifications, or reach out to them
> through LinkedIn"

Which is, in effect, an official endorsement of the strategy our ~30 ATS
discovery adapters already implement: go to the company career pages directly.
For Iceland that is likely to out-yield any board adapter.

## Answers to the three questions

**1. Biggest tech-relevant private boards.** **Alfreð** is genuinely dominant and
genuinely open — full job objects in SSR `__NEXT_DATA__`, 710 jobs nationwide,
19 in IT. **Tvinna** has the most permissive robots in the scan and about 29
live rows. **Störf.is** aggregates but links out. **Job.is** is behind a Vercel
security checkpoint (429) and is not even on the government's own list;
**mbl.is/atvinna** is Cloudflare-blocked; **northstack.is** has no jobs section.

**2. Public/official.** Yes, and it is clean: **Starfatorg** now lives on
island.is and is queryable through a public keyless GraphQL endpoint
(`https://island.is/api/graphql`, `icelandicGovernmentInstitutionVacancies`,
156 rows). **Vinnumálastofnun** has been folded into the same host. island.is
publishes no robots.txt. The problem is purely inventory: 103 of 156 rows are
healthcare and exactly one is classified `Tæknistörf`.

**3. Visa/relocation.** Nothing to ingest. Icelandic work permits are
employer-tied and per-application, so no certified-employer list exists.
`work.iceland.is` earns its place in this document as the primary source that
settles both that question and the market map — not as a feed.

## Checked, not worth it

- **Job.is** — HTTP 429 "Vercel Security Checkpoint" on `/robots.txt` and `/`
  with a desktop-Chrome UA; also absent from the government's own board list.
  `https://www.job.is/robots.txt`
- **mbl.is/atvinna** — Cloudflare 403 `Just a moment…` with a browser UA.
  `https://www.mbl.is/atvinna/`
- **northstack.is** — no jobs section; `/jobs` 404s on the Ghost site.
- **hhr.is** — empty `robots.txt` (200, 0 bytes) so fully crawlable, 311 KB of
  SSR, but it is a single agency in a market with 19 open IT jobs.
- **alfred.is sitemap** — declared in robots but holds **6 marketing URLs and no
  jobs**; the SSR page is the only door, and `?page=N` does not paginate
  server-side. `https://alfred.is/sitemap-web.xml`
- **island.is GraphQL** — works perfectly, returns 156 vacancies, 1 technical.
  Parked on inventory grounds, not access grounds.
- **Tvinna.is** — wide-open robots and a 1,697-URL job sitemap of which 29 are
  from 2026. `https://tvinna.is/sitemap.xml`
- **Störf.is** — no robots.txt, no JSON-LD, and its cards link off-site to
  employers rather than hosting the posting. `https://www.storf.is/`
