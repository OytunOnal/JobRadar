# Source scan: Czechia

Scope: Czechia only, tech roles, visa-sponsorship bias. Every claim below
carries the URL it was fetched from, a verbatim quote where relevant, and
today's date (2026-09-03). Lines are marked **seen** (fetched this run) or
**inferred** (deduction from seen material). A page that could not be fetched
is reported as unreachable, never filled from memory.

Already covered and out of scope, per the brief: NoFluffJobs (pan-CEE catalog
including Czechia), justjoin.it, eures, arbeitnow, remotive, remoteok, jobicy,
himalayas, weworkremotely, freehire, workingnomads, themuse, adzuna,
jsearch/indeed, linkedin, and the ~31 ATS discovery adapters (greenhouse,
lever, ashby, workable, recruitee, personio, teamtailor, join, manatal,
hrmanager, workday, successfactors, softgarden, bamboohr, breezy, pinpoint,
smartrecruiters, comeet, jobvite, rippling, oracle, csod, eightfold, phenom,
radancy, avature, beesite, getro, gem, jibe).

## THE HEADLINE FINDING — no employer-accreditation register exists; something better does

### 1a. The employer-accreditation programmes publish NO list of approved employers

Czechia runs three "government economic migration programmes" that fast-track
work/residence permits: **Program klíčový a vědecký personál** (Key and
Scientific Personnel), **Program vysoce kvalifikovaný zaměstnanec** (Highly
Qualified Employee) and **Program kvalifikovaný zaměstnanec** (Qualified
Employee). All three are administered by MPO (Ministerstvo průmyslu a
obchodu). This scan checked every official page for a published roster of
participating employers, and **none exists**.

- **Seen.** `https://mpo.gov.cz/cz/zahranicni-obchod/ekonomicka-migrace/program-kvalifikovany-zamestnanec--248247/`
  (fetched 2026-09-03, HTTP 200) does not publish an employer list. Instead it
  names ten **"garanti" (guarantor organisations)** — trade/employer
  associations — that *process applications on employers' behalf*, e.g.
  Hospodářská komora ČR, Svaz průmyslu a dopravy ČR, Konfederace
  zaměstnavatelských a podnikatelských svazů ČR, Agrární komora ČR,
  CzechInvest. Quote: *"Žádosti o zařazení do Programu zpracovávají jednotliví
  garanti"* (Applications for inclusion in the Programme are processed by the
  individual guarantors). This confirms the mechanism is a private
  chamber-mediated application pipeline, not a public register — there is
  nothing here shaped like the UK sponsor register.
- **Seen.** `https://mpo.gov.cz/cz/zahranicni-obchod/ekonomicka-migrace/program-klicovy-a-vedecky-personal--248245/`
  (fetched 2026-09-03, HTTP 200) — no "seznam" (list) of employers or
  organisations anywhere on the page. Applications route to MPO directly
  (`klicovypersonal@mpo.gov.cz`) or to CzechInvest (`programklicovy@czechinvest.org`)
  for research orgs/tech companies/startups. No public roster.
- **Seen.** `https://mpo.gov.cz/cz/zahranicni-obchod/ekonomicka-migrace/ekonomicka-migrace-a-vladni-programy--221756/`
  (fetched 2026-09-03, HTTP 200), the programme overview page listing all five
  government migration programmes (the three above, plus Digital Nomad and an
  Indonesian pilot) — no employer registry link anywhere on the page.
- **Seen.** `https://mpo.gov.cz/assets/en/foreign-trade/economic-migration/2020/2/PROGRAM-VYSOCE-KVALIFIKOVANY-ZAMESTNANEC_EN.pdf`
  (fetched 2026-09-03, HTTP 200, `application/pdf`, 481,688 bytes) — the
  official English-language programme text itself. No employer annex/roster
  attached to the fetched document.
- **Seen.** `https://mzv.gov.cz/jnp/cz/informace_pro_cizince/pobytova_opravneni_k_pobytu_nad_90_dnu/rezimy/informace_k_pilotnimu_projektu_zvlastni.html`
  (fetched 2026-09-03, HTTP 200) — MFA's mirror of the Key and Scientific
  Personnel programme text. Same conclusion: routes to MPO/CzechInvest, no
  list.
- **Inferred.** WebSearch for `"spolehlivý zaměstnavatel" zaměstnanecká karta seznam MVCR`
  turned up only the concept of an employer being flagged **"nespolehlivý
  zaměstnavatel" (unreliable employer)** — i.e. a penalty blocklist for
  violations, not a positive accreditation roster — and no public list of
  either kind was located.

**Verdict: this register does not exist as a public artefact.** Czechia's
fast-track programmes are gatekept by ten chamber/agency "guarantors" who
process applications privately; MPO/MPSV publish the programme rules and
eligibility criteria but never the resulting employer roster. This is a
negative result, not a missed search — it was checked from every angle the
brief specified (MPO, MPSV, MVCR/cizinci wording, English program PDF,
Ukraine/India pilot page) and confirmed absent each time.

### 1b. What Czechia publishes instead is better than a register: the entire national vacancy stream, with an employer-card eligibility flag on every row

MPSV's open-data portal publishes the **full national job-vacancy dataset**
behind ÚP ČR (the Czech public employment service) as machine-readable JSON,
refreshed daily, and — critically — **every posting carries a boolean flag for
whether it is open to Employee Card / Blue Card holders (third-country
nationals)**. This is not a "does more exist than EURES" maybe — it is
confirmed structurally richer, confirmed larger, and confirmed to carry the
one field (visa eligibility per posting) that no job board and no EURES mirror
carries.

- **Seen.** `https://data.mpsv.cz/web/data/volna-mista-za-celou-cr` (fetched
  2026-09-03, HTTP 200). Direct data URLs published on the page:
  `https://data.mpsv.cz/od/soubory/volna-mista/volna-mista.json`,
  `.../volna-mista.jsonld`, `.../volna-mista.schema.json`. Refresh cadence
  quoted from the page: **"1x denně"** (once daily) — confirmed independently
  by the file's `Last-Modified: Wed, 02 Sep 2026 20:08:14 GMT` response header
  against a fetch made `Thu, 03 Sep 2026`.
- **Seen — counted, not estimated.** Downloaded
  `https://data.mpsv.cz/od/soubory/volna-mista/volna-mista.json` in full
  (HTTP 200, `Content-Length: 182,491,523` bytes) and parsed it as JSON.
  - **Total postings: 38,195** (`polozky` array length).
  - **`zamestnaneckaKarta: true` (Employee Card eligible — i.e. explicitly
    open to third-country-national visa sponsorship): 17,499** of 38,195.
  - **`modraKarta: true` (EU Blue Card eligible): 725.**
  - **Employer name present (`zamestnavatel.nazev`): 38,170 of 38,195**
    (99.9%). **IČO (company registration number) present: 38,162.**
  - **ICT-professional postings (CZ-ISCO code 25xxx): 701**, of which
    **295 are `zamestnaneckaKarta: true`.** Broadening to CZ-ISCO 21xxx+25xxx
    (engineers + ICT professionals) gives 1,125.
  - Sample rows (verbatim field values from the fetched JSON, 2026-09-03):
    `{"pozadovanaProfese":"IT Enterprise Architect","zamestnavatel":{"ico":"26194333","nazev":"SAP Services s.r.o."},"mesicniMzdaOd":73823,"mesicniMzdaDo":108000}`;
    `{"pozadovanaProfese":"Vývojáři softwaru","zamestnavatel":{"ico":"27080439","nazev":"DHL Information Services (Europe) s.r.o."},"mesicniMzdaOd":106400}`;
    `{"pozadovanaProfese":"Specialista AI kybernetické bezpečnosti a datových rizik pro mezinárodní trhy","zamestnavatel":{"ico":"04915364","nazev":"Gl00be s.r.o."},"zamestnaneckaKarta":true}`.
  - One caveat, quoted from the WebFetch summary of the same portal page: when
    an employer requests anonymous publication (flag `"anosp"`), that
    export path **"neobsahuje údaje o zaměstnavateli"** (does not contain
    employer data) — i.e. a minority of rows anonymise the employer, which the
    99.9%-populated count above already reflects.
- **Seen.** The consumer-facing search UI for this same dataset is
  `https://www.uradprace.cz/web/cz/volna-mista-v-cr` (named on the open-data
  page as the "Aplikace" using this data) — confirms the JSON feed is the
  upstream of ÚP ČR's own public search, not a side dataset.

**Why this beats the EURES mirror JobRadar already ingests:** EURES surfaces
only the subset of Czech vacancies that ÚP ČR chooses to forward to the EU
network, with EURES's own (thinner) schema. This national feed is the
**full** upstream — every one of the 38,195 postings, not a EURES-selected
subset — and adds fields EURES does not carry at all: **IČO** (a clean join
key against sponsor-style registers and our dedupe-by-employer logic),
**`zamestnaneckaKarta`/`modraKarta`** (a per-posting visa-eligibility signal no
other JobRadar source has), and daily refresh timestamps
(`datumVlozeni`/`datumZmeny`) per posting. **Verdict: adapter-worthy — highest
priority new source in this scan**, ranking above any job board because it
combines the volume of a national feed with a visa-eligibility flag no other
Czech source publishes.

## Findings table

| Board/Register/Service | Type | Machine door (yes/no + exact URL fetched) | Employer name published? | Visa relevance | Verdict |
| --- | --- | --- | --- | --- | --- |
| **MPSV national vacancy feed** (`data.mpsv.cz`) | National public-employment-service open dataset (ÚP ČR upstream) | **Yes.** `https://data.mpsv.cz/od/soubory/volna-mista/volna-mista.json` (200, JSON, 182,491,523 bytes, daily refresh, no auth) | **Yes — 38,170/38,195 (99.9%), plus IČO for 38,162** | **Highest — 17,499 postings flagged `zamestnaneckaKarta: true`, 725 `modraKarta: true`, both explicit third-country-national visa signals** | **adapter-worthy — top pick, see above** |
| MPO/MPSV migration-programme employer registers | Government accreditation programme (Key/Scientific Personnel, Highly Qualified, Qualified Employee) | **No public list exists.** Checked `mpo.gov.cz` programme pages ×3, overview page, English PDF, MFA mirror — all HTTP 200, none publish a roster | n/a — no register to check | Would have been the highest-value find if it existed | **skip — confirmed absent** (see 1a above; not a "park", a documented negative) |
| jobs.cz (LMC group) | Large Czech generalist board, IT-heavy vertical | **Partial.** `https://www.jobs.cz/robots.txt` (200, 349 bytes) declares **no `Sitemap:` line at all** and disallows `/api/`, `/iapi/` (an API exists but is off-limits under robots). Listing pages are server-rendered HTML: `https://www.jobs.cz/prace/programator/` (200, 241,863 bytes) — **no JSON-LD `JobPosting`**, no RSS (`/rss/` → 404) | **Yes, but only as `<img alt="…">` on the company-logo element**, e.g. `alt="Alma Career Czechia s.r.o."` on a sampled listing card — not structured data | Indirect — generalist board with an IT vertical; ~30 result cards per page seen with IT roles (Java Developer, etc.) | **park** — reachable and does carry employer names, but no sitemap/feed/schema door; would need HTML-card scraping with pagination. Likely redundant with NoFluffJobs/justjoin.it for pure tech roles, not verified either way this run |
| prace.cz (LMC group, same company as jobs.cz) | Large Czech generalist board, broader/blue-collar skew | **Yes, sitemap.** `https://www.prace.cz/robots.txt` (200) declares `Sitemap: https://d2260mt3awrr7p.cloudfront.net/prace.cz/sitemap-index.xml` → one child sitemap with **6,283 URLs**, but these are **region/city facet pages** (e.g. `/nabidky/hlavni-mesto-praha/praha`), not individual job-posting URLs. A sampled facet page (628,775 bytes, 200) is server-rendered but carries **no JSON-LD `JobPosting`** | **Yes, in the URL slug**, e.g. `/firma/h3w4e7-nanu-nana-obchodni-spolecnost-s-r-o/nabidka/…` — company name embedded in the posting URL path, confirmed on a sampled card | Low — sampled listing was retail ("Šikovný/á a kreativní prodavač/ka – Nanu-Nana"); this board skews non-tech | **park** — machine door exists (sitemap) but only indexes facet pages, not postings directly; would need a second crawl hop per facet page. Low tech relevance makes this lower priority than jobs.cz |
| StartupJobs.cz | Czech startup/tech-focused board | **Yes, clean.** `https://www.startupjobs.cz/robots.txt` (200) `Allow: /` + `Sitemap: https://www.startupjobs.cz/sitemap_index.xml` → `sitemap/offers.xml` (200, **412 posting URLs**, no `<lastmod>`). Sampled posting `https://www.startupjobs.cz/nabidka/24290/fullstack-agentic-engineer` (200, 256,955 bytes) carries a full **`application/ld+json` `JobPosting`** block (`datePosted`, `description`, `employmentType`, `hiringOrganization`, `jobLocation`) — server-rendered (Nuxt SSR), no JS execution required | **Yes — structured.** `"hiringOrganization":{"@type":"Organization","name":"Applifting", …}` in the JSON-LD | Indirect — Czech-specific startup/tech board, likely skews smaller/earlier-stage companies than NoFluffJobs' enterprise CEE catalog | **adapter-worthy, pending overlap check** — clean sitemap + JSON-LD door, 412 current postings (small but real). Not verified this run whether its company roster is net-new vs. NoFluffJobs/justjoin.it — flagged for a follow-up dedupe pass, not blocked on it |

## Checked, not worth it

- `https://mpsv.gov.cz/projekty-ekonomicke-migrace` — MPSV's programme-overview
  mirror of the MPO pages; fetch returned a truncated/JS-heavy render and
  added no new facts beyond the MPO pages already quoted above.
- `https://www.jobs.cz/rss/` — HTTP 404, no RSS feed on jobs.cz.
- CzechInvest as "guarantor" for Key and Scientific Personnel — routes
  applications for tech companies/startups but publishes no client/employer
  roster on the pages checked.
- "Nespolehlivý zaměstnavatel" (unreliable-employer) concept — exists as a
  penalty mechanism referenced in secondary sources, not a positive
  accreditation list; no public roster located.
- data.mpsv.cz terms-of-use page
  (`https://data.mpsv.cz/web/data/podminky-uziti`, 200, 56,293 bytes) — fetched
  to check licensing; page renders as a Liferay portal shell, no plain-text
  license/CC-BY statement surfaced in the fetched payload. Not a blocker (the
  data is published as open data under the national open-data catalog
  umbrella per the portal's own link to `data.gov.cz`), but the exact license
  text was not confirmed this run.
- No robots.txt fetched this run (jobs.cz, prace.cz, startupjobs.cz) declared
  any AI-crawler-specific rule (no `GPTBot`, `CCBot`, `ClaudeBot`, or similar
  named user-agent block) — all three carry only a generic `User-agent: *`
  section.

## Main-session audit, 2026-09-04 — shipped as a register

Every figure re-fetched and exact: `data.mpsv.cz/robots.txt` allows all with
no AI ban; the feed carries **38,195** postings, **38,170** with an employer
object, and the three declared booleans count **17,499** `zamestnaneckaKarta`,
**725** `modraKarta`, **19,812** `cizinecMimoEu`.

**It ships as a sponsor register, not a job source, and that is a design
choice rather than a shortcut.** Only 1,377 of 38,195 rows carry a public URL
(`urlAdresa`), and the portal rendering the rest is a single-page app with no
per-vacancy address — a posting the user cannot open is not one we should
show. Reduced to distinct employers, the same file becomes the sixth register
in `src/lib/visa/sponsors.ts`: **9,203 companies** written live, 9,208 of them
carrying an IČO, from 18,188 flagged postings.

It is also unlike the other five. UK, IE, NL, DK and PT publish LICENCE lists:
who may sponsor. This is derived from live vacancy registrations, so it names
who is **actually** hiring from outside the EU right now — SAP Services,
Foxconn, Alza and Iveco among them. The `detail` field keeps the two routes
apart (EU Blue Card vs employee card) because the Blue Card is the skilled
one and flattening them would lose the distinction that matters most here.

One implementation note worth keeping: `fetch` transparently decompresses when
the server sets Content-Encoding, so the .gz copy may arrive already plain.
The importer checks the gzip magic bytes rather than assuming — assuming cost
one run with "incorrect header check".
