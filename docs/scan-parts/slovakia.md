# Slovakia — source scan (issue #31)

Date of all fetches: 2026-09-03. Every line below is either **seen** (fetched this run,
quoted) or **inferred** (marked explicitly). JobRadar already ingests NoFluffJobs
(pan-CEE, includes Slovakia) and justjoin.it, EURES, plus ~31 ATS discovery adapters —
see issue context. Findings below never re-propose those.

## TOP FINDING — no Slovak employer/accreditation register exists; only an occupation-code list

**Verdict: no adapter possible — there is no employer register to ingest. The
occupation list itself is a scoring input, not a source of postings.**

Unlike Czechia (Employer Programme "Klientský systém") or Hungary, **Slovakia's
fast-track scheme for hiring third-country nationals is occupation-based, not
employer-based.** There is no published list of employers approved/accredited/
registered to use the fast track. Confirmed by:

- Fetched `https://www.podnikajte.sk/zamestnanci-a-hr/zamestnanie-cudzincov-v-nedostatkovych-profesiach-od-1-1-2023`
  (article on the shortage-occupation regime): no mention of employer
  pre-registration, accreditation, or an employer list — the article describes the
  labour office issuing "potvrdenie o možnosti obsadenia voľného pracovného miesta"
  (confirmation of the possibility of filling a vacant post) keyed to the job's
  occupation code, not to any employer status.
- Searched (2026-09-03) `"klientský program"` / `"zoznam registrovaných
  zamestnávateľov"` + "cudzinci zrýchlené konanie" — no employer-register result
  surfaced; results only re-describe the occupation-list mechanism and the EU Blue
  Card's own (individual-application, not employer-list) fast track ("Blue Card
  benefits – faster proceedings (30 days), EU mobility, facilitated family
  reunification").
- Searched for a Slovak analogue of Czechia's "Program klíčový a vědecký personál" /
  employer whitelist — none found.
- The "národné vízum" (national visa) scheme for highly-qualified workers and
  drivers (Nariadenia vlády č. 520/2021, 521/2021, effective 1 April 2022) is a
  **country-and-quota** scheme (e.g. "3,000 national visas in 2022 for
  highly-qualified citizens", capped nationalities), not an employer-registration
  scheme. Fetched `https://www.employment.gov.sk/sk/uvodna-stranka/informacie-media/aktuality/narodne-viza-umoznia-prilev-mozgov-slovensko.html`:
  no employer-list mention; the quoted line is "Na základe udeleného národného víza
  bude vysokokvalifikovaným osobám z tretích krajín umožnený vstup na územie SR za
  účelom hľadania si zamestnania" (visa lets the holder enter *to look for* a job —
  applicant-driven, not tied to a pre-approved employer).

### The shortage-occupation LIST itself (useful for visa-relevance scoring, not adapter-worthy)

- **URL (landing page)**: `https://www.upsvr.gov.sk/sluzby-zamestnanosti/zamestnavanie-cudzincov/zoznam-zamestnani-s-nedostatkom-pracovnej-sily.html?page_id=806803`
  — fetched 2026-09-03, quote: "Tento zoznam zamestnaní s nedostatkom pracovnej
  sily slúži na zrýchlené administratívne konanie pri zamestnávaní štátnych
  príslušníkov tretích krajín."
- **Format**: one PDF per self-governing region (samosprávny kraj), 8 regions,
  refreshed quarterly. Current edition: "Platné pre III.Q.2026 najdlhšie do
  31.10.2026". Direct PDF URLs (fetched, all `200 application/pdf` where checked):
  - `https://www.upsvr.gov.sk/buxus/docs/SSZ/OISS/NEDOSTATKOVE_PROFESIE/2026/III.Q/Bratislavsky__samospravny_kraj.pdf` — **fetched and parsed, 200 OK, 474,314 bytes**
  - `.../Trnavsky_samospravny_kraj.pdf`, `.../Trenciansky_samospravny_kraj.pdf`,
    `.../Nitriansky_samospravny_kraj.pdf`, `.../Zilinsky_samospravny_kraj.pdf`,
    `.../Banskobystricky__samospravny_kraj.pdf`, `.../Presovsky_samospravny_kraj_.pdf`,
    `.../Kosicky__samospravny_kraj.pdf` — linked from the landing page, not
    individually fetched this run (same table structure inferred from Bratislava's).
  - Methodology doc: `.../2024/Metodika_identifikacie_nedostatkovych_profesii.docx`
- **Count (parsed, not estimated)**: the Bratislava-region PDF lists **70 distinct
  occupation codes** (6-digit ISCO-derived codes + Slovak occupation label), e.g.
  row 1 `2141999 Špecialista v oblasti priemyslu a výroby inde neuvedený`, and
  tech-relevant rows `2511002 IT architekt, projektant`, `2512001 Systémový
  programátor`, `2512002 Softvérový architekt, dizajnér`, `2521005 Dátový analytik`.
  No employer names, no job postings, no counts of open positions — purely a
  regional occupation whitelist.
- **Visa-relevance use**: could feed the visa-relevance scorer as a lookup table
  (occupation code/keyword → "fast-track eligible in region X this quarter"), but
  it is not a source of postings and not an employer register, so it does not meet
  the bar for a new ingest adapter.

## Table

| Board/Register/Service | Type | Machine door (yes/no + exact URL fetched) | Employer name published? | Visa relevance | Verdict |
|---|---|---|---|---|---|
| ÚPSVR shortage-occupation list (nedostatkové profesie) | Government list (occupations, not employers) | Yes — PDF per region, e.g. `https://www.upsvr.gov.sk/buxus/docs/SSZ/OISS/NEDOSTATKOVE_PROFESIE/2026/III.Q/Bratislavsky__samospravny_kraj.pdf` (fetched, 70 rows parsed) | N/A (no employer field) | High (fast-track eligibility signal) | park — scoring input only, not a postings source |
| Employer accreditation/register for fast-track hiring | Does not exist | No such register found (searched `upsvr.gov.sk`, `employment.gov.sk`, `mpsvr.sk`, and web search) | N/A | N/A | skip — confirmed absent |
| "Národné vízum" scheme (highly-qualified workers, drivers) | Government visa quota scheme, applicant-driven | No employer list; individual application at consulate/Interior Ministry — fetched `https://www.employment.gov.sk/sk/uvodna-stranka/informacie-media/aktuality/narodne-viza-umoznia-prilev-mozgov-slovensko.html` | N/A | High (context, not a data source) | skip — not a postings/employer source |
| Služby zamestnanosti (sluzbyzamestnanosti.gov.sk) — national vacancy portal | Government job board (ÚPSVR/MPSVR), EURES upstream for Slovakia | Yes — server-rendered HTML, `https://www.sluzbyzamestnanosti.gov.sk/pracovne-ponuky` (fetched: 200, listing UI with filters). No RSS/JSON/API found; open-data files at `upsvr.gov.sk/statistiky/open-data.html?page_id=955243` are aggregate statistics (VPM-01/02/03 JSON/XML), not per-posting data | Yes — seen sample employers "Liptovské pekárne a cukrárne VČELA - Lippek k.s.", "SP-TRANS, s.r.o." | Medium (general labour-market signal, not visa-specific) | already-covered-via-EURES — page states site is the source feeding into the EURES database for Slovakia; scale seen on page: "24 854 pracovných ponúk, 8 789 zamestnávateľov, 144 350 pracovných miest" (inferred to already flow to EURES per official description found in search, not independently cross-counted against EURES SK) |
| ÚPSVR open-data statistics (VPM-01/02/03, UoZ datasets) | Government open data | Yes — JSON/XML/XSD, e.g. `/statistiky/open-data/VPM-01-zakladne-ukazovatele.json` under `upsvr.gov.sk` | No (aggregate counts only, no individual postings) | Low | skip — statistical aggregates, not postings |
| Profesia.sk | Commercial job board (dominant in Slovakia) | **No — blocked.** `https://www.profesia.sk/robots.txt` and `https://www.profesia.sk/` both returned HTTP 403 from CloudFront WAF ("Request blocked... Generated by cloudfront") on every fetch attempt (WebFetch and direct Node fetch with browser User-Agent) | Unknown (unreachable) | Unknown (unreachable) | skip — unreachable this run, cannot evaluate |
| Pracuj.sk | Commercial job board (general, react/JS front end) | Partial — `https://pracuj.sk/robots.txt` fetched (200, unrestricted, `Sitemap: https://pracuj.sk/sitemap.xml`); sitemap fetched (~700 URL entries, mixed job/company/blog pages, not a large live-postings count). Raw HTML has no `application/ld+json` (checked via Node fetch, `contains ld+json? false`) | Yes — seen "LKQ SK s.r.o.", "Grafton Slovakia s.r.o.", "MATIVE s.r.o.", "Gi Group Slovakia, s.r.o." | Low (general board, agency-heavy, no visa signal seen) | park — small scale, no structured data, general-purpose not tech-focused |
| Job.sk | Commercial job board (general) | Partial — `https://www.job.sk/robots.txt` fetched (200): `Disallow: /Services/`, `Disallow: /stranka-neexistuje`, `Sitemap: https://www.job.sk/Sitemap.aspx`. Homepage fetched; small per-category counts seen (e.g. "Obchod" 11, "Zdravotníctvo a farmácia" 18) | Not verified this run | Low | park — appears small scale; not deeply verified |
| Kariera.sk (kariera.zoznam.sk) | Commercial job board (general, part of Zoznam portal group) | Partial — `https://kariera.zoznam.sk/robots.txt` fetched (200): blocks language paths (`/de/`, `/en/`, `/cs/`), `/lib/`, `/rss/`, `/upload/`, `/cv/`, search/purchase query patterns; `Sitemap: https://kariera.zoznam.sk/sitemap-29052025` and a magazine sitemap. Listing page fetched: `https://kariera.zoznam.sk/pracovne-ponuky/vsetky/slovenska-republika` shows total "Práca Slovenská republika (7620)". No `application/ld+json` / JobPosting schema found in raw HTML (checked via Node fetch) | Yes — seen "MADWIRE, s. r. o.", "McDonald's", "Lidl Slovenská republika, s.r.o." | Low (general/retail-heavy postings seen, no visa signal) | park — 7,620 postings is sizable but general-purpose, no structured schema, no visa relevance seen |

## Checked, not worth it

- `https://www.mic.iom.sk/sk/novinky/534-zoznam-zamestnani-s-nedostatkom-pracovnej-sily.html` — IOM migration-info-centre mirror of the same shortage-occupation list; not a primary source, redundant with the ÚPSVR original.
- `https://www.mzv.sk/en/web/washington/sluzby/informacie-pre-cudzincov/narodne-viza` — embassy-hosted explainer of the národné vízum scheme; confirms applicant-driven process, no employer angle, redundant with `employment.gov.sk` article already quoted above.
- `https://www.slov-lex.sk/pravne-predpisy/SK/ZZ/2021/521/` and `.../520/2021` — the underlying government regulations for the national-visa quotas; legal text, not a data source, not fetched (out of scope — no postings/employer data expected).
- `https://www.employment.gov.sk/datasety/` — MPSVR generic "datasets" landing page; surfaced in search but the concrete files live under `upsvr.gov.sk/statistiky/open-data.html` (already covered in the table as aggregate stats, no postings).
- `https://www.geoportalksk.sk/...` (Košice self-governing region GIS record on vacancy counts by district) — a GIS metadata record, not a job/employer data source.
