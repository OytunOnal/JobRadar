# Source scan: Latvia

Scope: Latvia only, tech roles, visa-sponsorship bias. Primary sources only —
every row below names a URL that was actually fetched. Where a fetch was
refused, the URL was retried from Node with a desktop-Chrome User-Agent before
the site was declared closed.

Already covered and therefore out of scope: eures, nofluffjobs, justjoin.it,
arbeitnow, remotive, remoteok, jobicy, himalayas, weworkremotely, freehire,
workingnomads, themuse, adzuna, jsearch/indeed, linkedin, plus the ~31 ATS
platforms that already have discovery adapters.

Scanned 2026-09-03.

## Headline

Latvia's Startup Law register is real, published, and substantially bigger
than anything Estonia offers: LIAA (the Investment and Development Agency)
publishes **"Atbalstīto jaunuzņēmumu reģistrs"** (Register of Supported
Startups) as a downloadable XLSX, dated **19.08.2026**, with **353 companies**
— each row carrying a legal name, a **company registration number** (the same
identifier used across the Latvian company registry — a direct join key), a
legal address, the evaluation-commission decision date and number, and which
support programme was granted. This is the single best visa-adjacent find of
the whole Baltic sweep — bigger than Estonia's 17-company fast-track list and
structurally identical in shape to the UK/Ireland/Netherlands/Denmark/Portugal
registers already ingested.

The rest of Latvia is harder. NVA (the public employment service) routes its
entire vacancy search to a client-rendered SPA with no sitemap and no
discoverable API. CV.lv bans ClaudeBot outright. **Prakse.lv** is the one live
job-listing door: server-rendered, employer name shown on every card, but a
small (230-posting), internship-skewed pool shared across three language
locales rather than segmented by country.

## Findings

| Source | Type | Machine door? | Verified URL | Employer name published? | Visa relevance | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| **LIAA — Atbalstīto jaunuzņēmumu reģistrs** (Register of Supported Startups) | Latvia's Startup Law qualifying-company register | **Yes — a direct XLSX download, no login.** The HTML page states *"Atbalstīto jaunuzņēmumu reģistrs uz 19.08.2026."* with a link to the file. Downloaded and parsed (34,721 bytes, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`): sheet1 has 357 XML rows, of which **353** are data rows with a numeric `Nr.p.k.` (row 1 = `SIA "Dripitio"`, reg. no. `50203008551`; row 353 = `Aralia SIA`, reg. no. `40203164952`). Columns: `Nr.p.k.`, `Nosaukums` (company name), `Reģistrācijas Nr.` (registration number), `Juridiskā adrese` (legal address), `Vērtēšanas komisijas lēmums` (decision date + number), `Atbalsta programmas` (support programme, e.g. *"Atbalsts augsti kvalificētu darba ņēmēju piesaistei un UIN atlaide"* — support for hiring highly-qualified employees + corporate tax relief) | `https://liaa.business.gov.lv/atbalsta-iespejas/jaunuznemumu-atbalsts?subsection=atbalstitie-jaunuznemumi` (200, 836,116 bytes) → XLSX at `https://s3.storage.pub.lvdc.gov.lv/liaa-bucket/shared/business.gov.lv/eiis-files/cms_uploads/Jaunuz%C5%86%C4%93mumu%20programma/Atbalst%C4%ABto%20jaunuz%C5%86%C4%93mumu%20re%C4%A3istrs%20uz%2019.08.2026.xlsx` (200, 34,721 bytes) | n/a — this is a company register, not a job board | **Highest of the whole scan** — one of the support programmes is explicitly the "highly qualified employee" wage subsidy, i.e. it names companies actively bringing in skilled hires | **register-worthy — ingest directly.** 353 named companies with registry numbers is real, structured, dated data; a strong new `VisaSponsor`-shaped source and a seed list for company-board discovery |
| **NVA** (Nodarbinātības valsts aģentūra — Latvia's public employment service) | National public employment service — the EURES upstream | **No usable door.** `robots.txt` (200, 1,913 bytes) is clean (no AI-crawler ban) but declares **no** `Sitemap:` line. `https://www.nva.gov.lv/lv/vakances` (200, 249,077 bytes) renders no listings itself — it links out via `data-external-link="TRUE"` to `https://cvvp.nva.gov.lv/#/pub/`, labelled *"NVA reģistrētās vakances, Ārējā saite"*. That target (`cvvp.nva.gov.lv`, "CV un Vakanču Portāls") is `<body ng-app=burvisApp>` — a client-rendered SPA (`app.f1893a9d.css`, `app.908f6a4f.js`, Vue/Angular chunk-naming). Its own `robots.txt` is **404** (no file) and `/sitemap.xml` is **404**. The loaded `app.908f6a4f.js` (794,200 bytes) was searched for `/api/*` paths — none found | `https://www.nva.gov.lv/robots.txt`, `https://www.nva.gov.lv/lv/vakances`, `https://cvvp.nva.gov.lv/`, `https://cvvp.nva.gov.lv/sitemap.xml` | **Unconfirmed** — no vacancy content reached in server-rendered HTML | Highest by intent — the state's own channel, EURES upstream | **park.** Same shape as Estonia's Töötukassa: real service, no sitemap, no discoverable API within this pass |
| **CV.lv** | Latvia's major private board (same corporate family as CV.ee/CVonline.lt) | **No — explicit AI-crawler ban.** `robots.txt` (200, 1,875 bytes), byte-for-byte the same Cloudflare "Content-Signal" template as CV.ee: `User-agent: ClaudeBot` / `Disallow: /`, alongside Amazonbot, Applebot-Extended, Bytespider, CCBot, Google-Extended, GPTBot, meta-externalagent | `https://www.cv.lv/robots.txt` | Not checked — ban respected before any further fetch | Would be significant | **skip — AI-crawler ban, respected.** No further pages fetched from this host |
| **Prakse.lv** | Baltic-wide internship/entry-level board with an active vacancy pool, serving lv/en/ru/lt/et locales | **Yes — server-rendered, no ban.** `robots.txt` (200, 95 bytes) has no AI-crawler section, only 4 asset-path disallows. `sitemap.xml` (200, 54,589 bytes, 114 URLs) covers static pages only, not individual postings — `/vacancies` and `/vacancy/list` appear but no per-job URLs are enumerated there. The `/en/vacancies` listing page itself, however, is server-rendered: strips to real content showing **`230` results**, identical across `/en/`, `/lt/`, `/et/` locale variants (same underlying pool, language-toggled, not country-filtered). Job cards show title, employer, type, location, deadline, e.g. *"Būvniecības projektu vadītāja asistents/-e \| Smart Energy, SIA \| Internship • till 17.09.2026 • Rīga, Latvia"*. Detail URLs embed the employer slug, e.g. `/vacancy/175317/smart-energy-sia/buvniecibas-projektu-vaditaja-asistents-e` | `https://www.prakse.lv/robots.txt`, `https://www.prakse.lv/sitemap.xml`, `https://www.prakse.lv/en/vacancies` | **Yes** — in the listing card text and in every detail URL slug | Low-moderate — filterable by "Work" vs "Internship" but the visible pool skews junior/internship (site literally frames itself as *"Find your first internship"*) | **park.** Real door, real employer attribution, but small (230 total, mixed with internships) and no sitemap of individual postings — would need listing-page pagination rather than a clean sitemap crawl. Revisit if the "Work"-only count proves substantial |

## Checked, not worth it

- **`liaa.gov.lv/lv/programmas/jaunuznemumu-atbalsta-programmas/apraksts`** —
  200 but redirects to the site root; the live register page is at
  `liaa.business.gov.lv`, not `liaa.gov.lv`, and was used instead (see table).
- **`business.gov.lv/atbalsta-programmas/jaunuznemumu-atbalsts`** — 404; the
  working host is the `liaa.business.gov.lv` subdomain with a `?subsection=`
  query param.
- **`cvvp.nva.gov.lv/sitemap.xml`** — 404, confirming no sitemap exists for
  the SPA.
- **Prakse.lv `sitemap.xml`** — fetched in full (114 URLs); none are
  individual vacancy pages, only static/category shells.

## Is anything better than what we already hold?

Yes, decisively, on the visa side: **the LIAA Startup Law register is new
inventory and the best of the three Baltic states** — 353 named, dated,
registry-numbered companies is bigger than Iceland's entire tech job count and
directly comparable in shape to the five sponsor registers already in
`src/lib/visa/sponsors.ts`. On the job-board side, nothing clears the bar: NVA
is a closed SPA with no sitemap, CV.lv is banned, and Prakse.lv is real but
small and internship-skewed.

## Main-session audit, 2026-09-04 — NOT added to the sponsor registers

The register is real and the agent's count is exact: the XLSX downloads
without a login (34,721 bytes) and holds 353 data rows with company name and
registration number.

**It is nonetheless not a sponsor register, and adding it would blur a label
this project has already had to repair once.** Parsing the support-programme
column splits the 353 into distinct claims: **212** companies are in the fixed
tax-payment and income-tax-relief programmes, which have nothing to do with
hiring foreigners, and **63** are in "Atbalsts augsti kvalificētu darba
ņēmēju piesaistei" — support for attracting highly qualified employees.

Even those 63 hold a weaker claim than any register we ingest. A UK licensed
sponsor, an IND recognised sponsor or a Czech employer registering a
non-EU-open vacancy has stated something about sponsorship; a Latvian startup
receiving a wage subsidy for skilled hires has not. `sponsor?` means
"registered sponsor", and stretching it to cover subsidy recipients is
exactly how `sponsor✓` and `sponsor?` once came to describe the same posting.

Recorded instead as a **discovery seed**: 353 named Latvian startups with
registry numbers is a good company list for the name-probe lane, the same
verdict Next Level Jobs EU received.
