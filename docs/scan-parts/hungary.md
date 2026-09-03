# Source scan: Hungary

Scope: Hungary only, tech roles, visa-sponsorship bias. Every claim below
carries the URL it was fetched from, a verbatim quote where relevant, and
today's date (2026-09-03). Lines are marked **seen** (fetched this run) or
**inferred** (deduction from seen material). A page that could not be fetched
is reported as unreachable, never filled from memory.

Already covered and out of scope, per the brief: NoFluffJobs (pan-CEE catalog
— roughly 4,500 Hungarian postings alone), justjoin.it, eures, arbeitnow,
remotive, remoteok, jobicy, himalayas, weworkremotely, freehire,
workingnomads, themuse, adzuna, jsearch/indeed, linkedin, landingjobs,
spainjobsio, freework, nextleveljobs, englishjobsde, huntukvisa, visajobsie,
jobindexdk, itjobbank, demando, alfred, nav-no, sweden-jobtech, duunitori,
denmark, thehub, karriereat, cercolavoro, ergodotisi, vdab, swissdevjobs,
jobs-ch, jobup-ch, plus the ~31 ATS discovery adapters (greenhouse, lever,
ashby, workable, recruitee, personio, teamtailor, join, manatal, hrmanager,
workday, successfactors, softgarden, bamboohr, breezy, pinpoint,
smartrecruiters, comeet, jobvite, rippling, oracle, csod, eightfold, phenom,
radancy, avature, beesite, getro, gem, jibe).

## THE HEADLINE FINDING — the employer register exists, and it names real (mostly non-tech) sponsors

### 1a. `kormany.hu` publishes a live, named, downloadable register of guest-worker employers

Hungary's guest-worker route (vendégmunkás-tartózkodási engedély, 2023. évi L.
törvény) runs on two employer tracks: **"kedvezményes foglalkoztató"**
(privileged/direct employer) and **"minősített kölcsönbeadó"** (qualified
temp-work/staffing agency, i.e. lender of labour force). Only employers on
this register may sponsor guest workers.

- **Seen.** `https://kormany.hu/dokumentumtar/kedvezmenyes-foglalkoztatok-es-minositett-kolcsonbeadok-nyilvantartasa`
  (fetched 2026-09-03, HTTP 200) — "Kedvezményes foglalkoztatók és minősített
  kölcsönbeadók nyilvántartása" (Register of privileged employers and
  qualified lenders). Publishes **four downloadable files** (PDF ×3, XLSX ×1),
  all direct-linked, no login:
  - `https://kormany.hu/application/documents/11940db0-9bf1-43c3-af99-ae8d0ecd1a33/download`
    — "Vendégmunkások foglalkoztatására jogosult kedvezményes foglalkoztatók,
    valamint minősített kölcsönbeadók nyilvántartása", PDF, dated **2026.04.28**
    (the **combined** register — direct employers + staffing agencies).
  - `https://kormany.hu/application/documents/e3564cac-28ba-4719-954f-fff150d4e21b/download`
    and `.../b032c96c-6596-4acf-bb0a-2a57cbc135ca/download` — "Nyilvántartásba
    vett minősített kölcsönbeadók", PDF, dated **2026.05.08** (staffing
    agencies only, a subset).
  - `https://kormany.hu/application/documents/aee3ee91-4e32-46e6-9f8b-42a99fd8f62e/download`
    — same staffing-agency subset as an **XLSX**.
- **Seen — counted, not estimated.** Downloaded and parsed the combined PDF
  (2026.04.28, 48,461 bytes). It is a single table, **"Nyilvántartásba vett
  kedvezményes foglalkoztató, minősített kölcsönbeadó"**, columns: Sor-szám
  (row), Nyilvántartásba vételi határozat száma/kelte (registration decision
  no./date), **neve** (name), szervezeti formája (legal form),
  székhelyének címe (registered address), **adószáma** (tax ID), and — where
  applicable — Nyilvántartásból való törlést elrendelő határozat száma/kelte +
  **Törlés indoka** (deregistration decision + reason).
  - **Total rows: 35** (serial numbers 1–35, none skipped in this file).
  - **6 rows carry a deregistration date/reason**, i.e. **29 currently active**
    entries as published 2026-04-28.
  - Deregistration reasons seen verbatim: `"jogszabályi feltételek hiánya"`
    (failure to meet statutory conditions) on 4 rows, `"kérelemre"` (at the
    entity's own request) not present in this particular file's visible
    deletions (both reasons appear in the 2026-05-08 staffing-only subset,
    see below).
  - Sample rows quoted verbatim from the fetched PDF text layer: `"27 BP/0702/00032-4/2024 2024.04.11 Magyar Suzuki Zrt. Zrt. 2500 Esztergom Schweidel utca 52. 10552821-2-11"`;
    `"31 BP/0702/00034-4/2024 2024.04.22 HANKOOK TIRE Magyarország Kft. Kft. 2459 Rácalmás Hankook tér 1. 13602059-2-07"`;
    `"33 BP/0702/00036-4/2024 2024.05.24 TDK Hungary Components Kft. Kft. 9700 Szombathely Csaba utca 30. 11307064-2-18"`;
    `"28 BP/0702/00029-4/2024 2024.04.11 AUMOVIO Hungary Kft. Kft. 8200 Veszprém Házgyári út 6-8. 10518869-2-19"`.
    Alongside these direct manufacturing employers sit staffing agencies:
    `"2 BP/0702/00001-4/2024 2024.03.06 Prohuman Zrt."`, `"6 ... Trenkwalder HR Solution Kft."`
  - **This is the finding the brief asked for**: a government-published,
    named, address- and tax-ID-carrying employer register tied directly to a
    visa/work-permit route — the Hungarian analogue of the UK/IE/NL/DK/PT
    sponsor registers already ingested. Crucially it is **not** purely a
    staffing-agency list — the direct-employer rows are dominated by
    **automotive/manufacturing** names (Suzuki, Hankook Tire, TDK, AUMOVIO —
    the Continental Automotive spin-off, KOMETA 99, Le Bélier, Güntner-Tata,
    Bayer Construct, JIATAI Hungary Construction) — employers **NoFluffJobs'
    tech catalog would never surface**, which is exactly the
    non-tech-niche/manufacturing sponsor coverage the brief flagged as
    valuable.
  - **Seen — cross-check.** The 2026-05-08 staffing-agency-only XLSX
    (`aee3ee91…download`, 30,252 bytes, parsed as OOXML/zip) contains **28
    numbered entries** (serials 1–29, #12 absent from the sheet), of which
    **10 carry a deregistration record → 18 currently active** staffing
    agencies. This file is a strict subset of the combined 35-row list above
    (same names: Prohuman Zrt., Pannon-Work Zrt., Trenkwalder HR Solution
    Kft., Randstad Hungary Kft. [deregistered, `"jogszabályi feltételek
    hiánya"`], ADECCO Személyzeti Közvetítő Kft. [deregistered, `"kérelemre"`],
    HSA Kft., etc.).
- **Seen.** `https://oif.gov.hu/factsheets/information-for-employers-and-host-organisations-employing-guest-workers-in-hungary`
  (fetched 2026-09-03) confirms the legal basis: *"Qualified temporary work
  agencies (i.e. lenders of labour force) are: employers who are registered in
  the Registry of qualified temporary work agencies as defined in Government
  Decree."* — matching the kormany.hu register found above.

**Format: PDF (2 variants) + XLSX. Not an API, not RSS — a static
document-store download, refreshed on an irregular cadence (two different
"as of" dates seen: 2026-04-28 and 2026-05-08 for the two files).**

### 1b. Critical caveat found this run: the guest-worker *route itself* is currently frozen for new applicants

- **Seen (via WebSearch, corroborated across CMS Law, Fragomen, Envoy Global,
  Erickson Immigration Group, and WTS Klient legal-update pages, all dated
  June 2026).** Hungary enacted **Government Decree No. 92/2026** (5 June
  2026), effective **6 June 2026**, which — because no third countries remain
  designated as eligible source countries under the amended framework — means
  **no new guest-worker residence-permit applications can currently be
  submitted**. Applications filed and paid for by 5 June 2026 continue under
  the prior rules; existing permit-holders may still apply to extend/reissue.
  The **employment-purpose residence permit** track (a separate, harder-vetted
  route) and the **EU Blue Card** remain unaffected.
- This means the kormany.hu employer register (§1a) is presently a register of
  who is **still legally allowed to hold** guest-worker sponsorship rights
  once/if the country-eligibility list reopens, and of who directly employs
  such workers already in-country — it is not, right now, a channel through
  which a new hire could be onboarded via this specific permit type. It
  remains directly relevant to JobRadar as a **sponsor-signal / dedupe-join
  register** (the employer names + adószám are usable for cross-referencing
  which companies are demonstrably willing to sponsor non-EU labour in
  Hungary), independent of which specific permit track is currently open.

### 1c. The guest-worker quota is national and un-broken-down — no per-employer or per-sector list exists there

- **Seen.** `https://kormany.hu/hirek/a-magyar-munkahelyek-a-magyaroke-a-nemzetgazdasagi-miniszter-2026-ra-is-35-ezer-foben-hatarozza-meg-a-vendegmunkas-kvotat`
  and the underlying **35/2025. (XII. 3.) NGM rendelet**
  (`https://net.jogtar.hu/jogszabaly?docid=a2500035.ngm`) — confirmed via
  WebSearch summary quoting the regulation text: the 2026 nationwide cap for
  combined employment-purpose + guest-worker residence permits is **35,000**,
  with *"A rendelet területi szabályozást nem tartalmaz, azaz nincs külön
  meghatározott kvóta országonként vagy vármegyénként"* (the regulation
  contains no territorial breakdown — i.e. no separate quota per country or
  county). **Verdict: this is a single national number, not an
  employer/sector list — nothing to ingest here beyond the headline figure.**

## Findings table

| Board/Register/Service | Type | Machine door (yes/no + exact URL fetched) | Employer name published? | Visa relevance | Verdict |
| --- | --- | --- | --- | --- | --- |
| **kormany.hu guest-worker employer register** (kedvezményes foglalkoztatók + minősített kölcsönbeadók) | Government accreditation register (economic-migration sponsor list) | **Yes — direct file download, no login.** `https://kormany.hu/dokumentumtar/kedvezmenyes-foglalkoztatok-es-minositett-kolcsonbeadok-nyilvantartasa` → PDF/XLSX links above (200, fetched 2026-09-03) | **Yes — 35/35 rows carry name + adószám (tax ID) + address** | **Highest — named sponsors incl. Suzuki, Hankook Tire, TDK, AUMOVIO (manufacturing, not tech); route itself currently frozen for new applicants (Decree 92/2026, 6 June 2026) but register remains a live sponsor-signal/dedupe source** | **adapter-worthy — parse as a periodic (irregular-cadence) sponsor-list ingest, not a job-posting source; pair with the freeze caveat in any UI surfacing** |
| Nemzeti Foglalkoztatási Szolgálat / Virtuális Munkaerőpiac Portál (VMP) — the actual national vacancy database behind EURES-HU | National public-employment-service vacancy portal | **Partial.** No `robots.txt` (`https://vmp.munka.hu/robots.txt` → HTTP 404, fetched 2026-09-03), no sitemap found. Listings are server-rendered HTML behind `https://vmp.munka.hu/allas/talalatok/` (200) but the full list requires JS/session; unfiltered query returns a hard cap message | **No — employer name is login-gated.** Fetched `https://vmp.munka.hu/allas/talalatok/?kategoria=2` (200): the Foglalkoztató (employer) column reads verbatim `"Bejelentkezés után látható"` (visible only after login) for every row | Low — no employer names without an account; unclear ToS/legality of scraping behind login | **skip** — the one field JobRadar needs (employer name) is deliberately hidden pre-login; do not build a login-scraping adapter |
| Same VMP portal — total open-vacancy count | — | **Seen — counted, not estimated.** `https://vmp.munka.hu/allas/talalatok/` (200, fetched 2026-09-03) unfiltered query returns verbatim: `"A lista túl sok elemet tartalmaz (1771), kérjük, szűkítse az eredményt keresési feltételek meghatározásával!"` → **1,771** total open vacancies nationwide, all sectors, right now | n/a (count only) | n/a | **Confirms NFSZ's own live vacancy total (1,771) is far smaller than NoFluffJobs' ~4,500 Hungarian postings alone** — even before the employer-name gate above, this source would add little volume |
| CVonline.hu | Hungarian generalist job board (Alma Media network) | **Partial — sitemap yes, content gated.** `https://cvonline.hu/robots.txt` (200) is a generic Drupal robots file, `Crawl-delay: 10`, no AI-specific ban, no `Sitemap:` line in robots.txt itself; found separately at `https://www.cvonline.hu/hu/sitemap.xml` (200) → sitemapindex with 2 child pages, **5,000 + 674 = 5,674 URLs** (`?page=1`, `?page=2`, fetched 2026-09-03). But individual job-posting pages, e.g. `https://www.cvonline.hu/hu/allas/gl-accountant-1180639` (200, 3,701 bytes), return a **bot-check interstitial**, verbatim: `<title>Bot Check</title>` / `<h1>Verification Required</h1>` / `"Press the button to continue."` — a JS click-through challenge, not scriptable via plain fetch | **Unknown — blocked by the bot-check wall before content is reachable** | Listing titles visible only in URL slugs suggest mostly non-tech roles (accounting, banking back-office, admin) — plausible manufacturing/traditional-employer coverage NoFluffJobs misses, but unverified since detail pages are gated | **park** — real sitemap door with ~5,600 postings, likely non-tech-relevant per the brief's visa-sponsorship angle, but every detail page sits behind an active bot challenge; not scriptable without solving that gate, which this scan does not attempt |
| Profession.hu | Dominant Hungarian generalist/tech job board | **Unreachable — confirmed across four independent methods, all failed.** `https://www.profession.hu/robots.txt` via (1) Node `fetch` — `ERR fetch failed`; (2) `curl -L -A "Mozilla/5.0…" --ssl-no-revoke` — exit code 28 (timeout); (3) PowerShell `Invoke-WebRequest` — `"Unable to connect to the remote server"`; (4) Chrome browser navigation (via claude-in-chrome) to both `/robots.txt` and `/` — `"Frame with ID 0 is showing error page"`. No archived copy at the Wayback Machine either (`archive.org/wayback/available?url=profession.hu/robots.txt` → `"archived_snapshots":{}`) | Not determined — never reached | Not determined — never reached | **park (unreachable this run)** — cannot assess robots.txt, sitemap, JSON-LD, or employer-name publication; per the brief's context, Profession.hu is presumed largely redundant with NoFluffJobs' ~4,500 HU postings for tech roles, so this is not a high-priority retry, but the site was never actually fetched and nothing here should be treated as confirmed |
| Jobline.hu (hvg.hu-affiliated) | Generalist job board | **No — appears defunct/parked.** `https://www.jobline.hu/robots.txt` (200) contains only the new Cloudflare "content-signals" boilerplate (search/ai-input/ai-train opt-out notices), no `Disallow`/`Sitemap` lines. Homepage `https://www.jobline.hu/` (200, 11,577 bytes) is a cached/static shell whose favicon path reads `https://cdn.hvg.hu/jobline/karbantartas/favicon.ico` — `"karbantartas"` = Hungarian for "maintenance". `sitemap.xml` and `sitemap_index.xml` both 404 | Not determined | Not determined | **skip** — site shows signs of being in maintenance/parked state; no functioning machine door found |

## Checked, not worth it

- `https://nfsz.munka.hu/robots.txt` (200) — permissive (`Allow: /` with a few
  asset-directory disallows), but the NFSZ marketing site itself has no open
  vacancy dataset/API; the real vacancy data lives at `vmp.munka.hu` (see
  table above), which gates the one field (employer name) JobRadar needs.
- `https://kozadat.hu/kereso/forras/213783/index.html` (Hungarian open-data
  catalog entry for NFSZ) — describes NFSZ's services (job listings, CV
  database, career-orientation portals) but publishes no downloadable
  dataset, API, or feed link.
- EURES relationship — VMP/NFSZ's live count (1,771 open vacancies
  nationwide, all sectors, seen 2026-09-03) confirms the domestic source is
  **smaller**, not larger, than what EURES already mirrors for Hungary and
  what NoFluffJobs already carries; no case for ingesting NFSZ/VMP even
  ignoring the employer-name gate.
- `https://kormany.hu/application/documents/af0fbc90-1108-4fab-bedf-96982a1f5913/download`
  ("I N D O K O L Á S" — explanatory memorandum for the 2026 guest-worker
  quota decree) — found via WebSearch, not separately fetched; the quota
  figure (35,000, national, no breakdown) was already confirmed via the
  kormany.hu news article and net.jogtar.hu text summary (§1c above).
- Enter Hungary (`enterhungary.gov.hu`) — the employer-facing e-government
  platform used to submit guest-worker/Blue Card applications and notify
  OIF/NDGAP of employment changes. It is a transactional portal requiring
  Cégkapu (business-gateway) authentication, not a public register or feed —
  confirmed via WebSearch summaries of `oif.gov.hu` factsheet pages, not
  separately fetched this run.
- "EU Blue Card employer registration list" — searched explicitly per the
  brief; no such public list surfaced. Applications route through Enter
  Hungary case-by-case; not all employers are eligible (labour-market test
  applies outside IT/engineering-exempt sectors) but there is no positive
  roster of pre-approved Blue Card employers analogous to §1a's guest-worker
  register.
