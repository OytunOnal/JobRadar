# Belgium source scan

Scope: Belgian job sources for a candidate needing **visa sponsorship**, with
the structural question front and center — Belgium's public employment
service is split by region, and JobRadar holds only Flanders (VDAB,
`src/lib/sources/vdab.ts`). Wallonia (Le Forem) and the Brussels-Capital
Region (Actiris) were unchecked; Brussels is where the EU-institution /
NATO / consultancy layer concentrates, which is the population this radar's
user can actually work in. Scanned 2026-09-03. Every yes/no below was decided
by fetching the URL in the row, not by reading a marketing page. Sources
already in the registry (EURES, VDAB, the ~31 ATS adapters, …) are out of
scope and named only where a Belgian board turned out to be a re-skin or
downstream of one.

## Verdict table

| Board / service | Type | Machine door? | Verified URL | Visa relevance | Verdict |
|---|---|---|---|---|---|
| **Le Forem — Open Data offres d'emploi** | Wallonia's public employment service, open dataset | **Yes** — OpenDataSoft REST API, structured JSON, no key. Live query returned `"total_count": 25917` | `https://leforem-digitalwallonia.opendatasoft.com/api/explore/v2.1/catalog/datasets/offres-d-emploi-forem/records?limit=5` → 200; sample record: `{"numerooffreforem":"2030588","titreoffre":"Domain Architect /x) (H/F/X)","lieuxtravaillocalite":["ANDERLECHT"],"lieuxtravailregion":["Belgique","RÉGION DE BRUXELLES-CAPITALE"],"nomemployeur":"ONAFHANKELIJKE ZIEKENFONDSEN - ZORGKAS VLAANDEREN","langues":["Néerlandais","Anglais","Français"],"url":"https://www.leforem.be/recherche-offres/offre-detail/2030588",...}` | Medium — dataset carries a `langues`/`languescodeiso2` field per posting (filter for `EN`), plus NACE sector codes; no explicit sponsorship flag | **Adapter-worthy (highest value)** — this is Wallonia's third of VDAB's role, filled |
| **Actiris — job-offer sitemaps** | Brussels-Capital Region's public employment service | **Yes** — dedicated per-language XML sitemaps of live job postings, declared in `robots.txt`; FR sitemap alone has **9,640** `<url>` entries, `lastmod` dated the day of the fetch (2026-09-03); detail pages are server-rendered HTML (full job description in the body, no JS needed) | `https://www.actiris.brussels/robots.txt` → `Sitemap: https://www.actiris.brussels/sitemapoffers-fr.xml`, `Sitemap: https://www.actiris.brussels/sitemapoffers-nl.xml`; sitemap fetch 200, e.g. `<loc>https://www.actiris.brussels/fr/citoyens/detail-offre-d-emploi/?reference=5923037</loc><lastmod>2026-09-03</lastmod>`; detail page 200, contains full `<h3>Description de la fonction</h3><p>Nous n'avons pas encore de service comptable interne...` body text | Medium — Brussels-specific, meta description carries contract type/commune, no sponsorship flag; population skews toward the international-employer layer the issue is chasing | **Adapter-worthy** — Brussels' third of VDAB's role, filled |
| **opendata.brussels.be** (City of Brussels open-data catalog) | Municipal open-data portal | Checked, no vacancy dataset exists. Catalog query for `emploi` returned exactly one hit — unemployment statistics by commune/gender, not postings; query for `offre` OR `job` OR `vacature` returned **zero** datasets | `https://opendata.brussels.be/api/explore/v2.1/catalog/datasets?where=title%20like%20%22emploi%22&limit=20` → 200, `total_count:1`, dataset fields are `commune`, `total_hommes`, `total_femmes` (unemployment stats); `...title%20like%20%22offre%22%20or...%22vacature%22...` → 200, `{"total_count": 0, "results": []}` | n/a | **Skip** — no vacancy data on this portal; Actiris's own sitemap is the real door |
| **data.gov.be** | Federal open-data catalog | Reachable (`200`) but not queried against a specific vacancy dataset before time ran out on this pass — no lead surfaced it independently of Le Forem/Actiris | `https://data.gov.be/en/search?query=vacatures` → 200 | n/a | **Park** — worth a targeted revisit, but Le Forem/Actiris already cover the ground it would plausibly index |
| **StepStone.be** | Major private generalist board (Axel Springer) | **No** — bot-challenged at the `robots.txt` itself: AWS WAF returns `202` with `x-amzn-waf-action: challenge`, empty body | `https://www.stepstone.be/robots.txt` → `202`, headers include `"x-amzn-waf-action":"challenge"`, `"server":"CloudFront"` | Medium (large generalist volume) | **Skip** — anti-bot wall, robots.txt itself unreadable so crawling permission can't even be established |
| **References.be** (Le Soir / Sudinfo) | Belgian francophone generalist board | **No** — root domain is a chooser/redirect page; the real jobs host (`jobs.references.be`, per its own TLS cert SAN list) is behind the same AWS WAF challenge signature as StepStone | `https://references.be/robots.txt` → 200 but body is an HTML "Choisissez votre édition" redirect page, not a robots file; `https://jobs.references.be/robots.txt` → `202`, `"x-amzn-waf-action":"challenge"` (same CloudFront/WAF fingerprint as StepStone.be) | Medium | **Skip** — anti-bot wall |
| **Jobat.be** | Major private generalist board (Roularta) | **Contradictory signals, net no.** `robots.txt` itself is reachable and permissive (declares a sitemap, only blocks login/old-article paths), but the declared sitemap URL is Cloudflare-blocked | `https://www.jobat.be/robots.txt` → 200, `Sitemap: https://www.jobat.be/sitemaps/sitemap.xml`; fetching that sitemap → `403`, Cloudflare "Sorry, you have been blocked" page, `<h2>...unable to access jobat.be</h2>` | Medium | **Skip (for now)** — the door robots.txt points to is itself walled off |
| **Talent.io (Belgium)** | Tech recruitment/matching platform | **No — company defunct.** Entered judicial reorganization Sept 2024; acquired via commercial-court proceedings by Davidson Consulting March 2025, which is winding down the permanent-hiring/job-board side. Technical corroboration: `www.talent.io` now resolves to a mismatched Heroku app (`*.herokuapp.com` cert, not `talent.io`) | web search corroboration only (see Sources below); `https://www.talent.io/robots.txt` → TLS error `Hostname/IP does not match certificate's altnames: ... DNS:*.herokuapp.com` | n/a | **Skip** — board no longer operating as a job source |
| **Actiris candidate API** (`api.actiris.brussels`, referenced inline in Actiris job-detail page HTML) | Possible internal REST API | **Unresolved** — hostname exists (`robots.txt` on it returns a 404 page, not a disallow), no public API documentation found via search; not pursued further given the sitemap door already works | `https://api.actiris.brussels/robots.txt` → `404` | n/a | **Park** — the sitemap+detail-page door already suffices; this would only matter if richer fields (salary, structured requirements) turn out to be needed later |
| **EPSO / EU Careers — Ongoing competitions** | EU institutions' own recruitment portal, third-country-national recruitment under its own rules | **Inconclusive.** Page is Drupal 11 with a server-rendered search form (Views exposed filter), but the raw HTML fetch contained no result rows (`views-row` / `view-content` markup absent) and no JSON-LD; `/jsonapi` returns 404 | `https://eu-careers.europa.eu/en/job-opportunities/in-progress` → 200, 79,403 bytes, form present (`views-exposed-form-epso-job-opportunities-main-search-block-3`), zero `views-row` matches; `https://eu-careers.europa.eu/jsonapi` → 404 | **High in principle** — EPSO/EU institutions recruit third-country nationals under their own rules, exactly the sponsorship-dense population the issue names | **Park** — plausible AJAX-rendered listing underneath the form; needs a follow-up pass with network-request inspection (headless browser) rather than a plain fetch, and/or a check at a moment competitions are actually open |
| **Belgian single permit / EU Blue Card employer register** (any of the 3 regions) | Government sponsorship-eligibility registry | **No register found**, at any region. Brussels' own economic-affairs page for the single permit / Blue Card, fetched directly, publishes only application procedure and required annexes — no employer list or link to one | `https://economie-emploi.brussels/permis-unique-carte-bleue-annexes` (fetched; page content confirms no registry link) | Would have been the highest-value single item, on the Netherlands-IND-register model | **Skip** — no equivalent to the Dutch IND public register exists for Belgium's single permit/Blue Card system, at national or regional level |

## Checked, not worth it

- **VDAB** — already ingested (`src/lib/sources/vdab.ts`); not re-scanned.
- **opendata.brussels.be, data.gov.be** — see table; catalog searches for
  vacancy/job/emploi/offre datasets came back empty or off-topic (unemployment
  statistics, not postings).
- **api.actiris.brussels** — hostname exists, no documentation surfaced, not
  needed given the sitemap door already works. Parked, not pursued.
- **Talent.io** — confirmed defunct as a job board (judicial reorganization
  2024, acquisition and wind-down of the permanent-hiring side by Davidson
  Consulting, March 2025).
- **StepStone.be, References.be/jobs.references.be** — both sit behind the
  same AWS-WAF "challenge" wall (`x-amzn-waf-action: challenge`), which blocks
  even reading `robots.txt`. Recorded as blocked, not routed around.
- **Jobat.be** — `robots.txt` is open and names a sitemap; the sitemap itself
  is Cloudflare-blocked. The declared door does not open.

## Note on Le Forem and Actiris robots.txt — read carefully before building

`www.leforem.be` (the marketing/search site) explicitly bans AI crawlers:

```
User-agent: GPTBot
Disallow:/

User-agent: ClaudeBot
Disallow:/
```

and separately disallows `/recherche-offres/` for **all** user-agents. That
ban was respected — no `leforem.be` page was scraped, and the site's own
search UI was never touched.

The working door is a **different host**: `leforem-digitalwallonia.opendatasoft.com`,
the OpenDataSoft-hosted open-data platform. Its own `robots.txt` carries no
ClaudeBot/GPTBot-specific entry; it has a generic `User-agent: * / Disallow:
/api/` (OpenDataSoft's standard platform-wide robots file, presumably meant to
keep search engines from indexing raw API responses) alongside an explicit
`User-agent: Googlebot / Allow: /api/`. This is a different kind of rule than
an AI-crawler ban — it is a general "don't crawl this like a search engine"
line on a platform whose entire purpose is programmatic API access (it has a
published API console). Flagging the distinction rather than resolving it:
the orchestrator should decide whether a generic `Disallow: /api/` for
`User-agent: *` on an open-data platform is treated the same as the explicit
per-bot bans found elsewhere in this project's scans, before an adapter is
built against it.

Actiris's `robots.txt` carries no AI-crawler ban at all — only `Disallow:
/media/` — so the sitemap+detail-page door there is unambiguous.

## Sources fetched this pass (for reference)

- `https://leforem-digitalwallonia.opendatasoft.com/api/explore/v2.1/catalog/datasets/offres-d-emploi-forem/records?limit=5`
- `https://www.leforem.be/robots.txt`
- `https://leforem-digitalwallonia.opendatasoft.com/robots.txt`
- `https://leforem-digitalwallonia.opendatasoft.com/api/explore/v2.1/catalog/datasets/offres-d-emploi-forem/records?where=lieuxtravailregion%20like%20%22BRUXELLES%22&limit=1`
- `https://www.actiris.brussels/robots.txt`
- `https://www.actiris.brussels/sitemapoffers-fr.xml`
- `https://www.actiris.brussels/fr/citoyens/detail-offre-d-emploi/?reference=5923037`
- `https://api.actiris.brussels/robots.txt`
- `https://opendata.brussels.be/api/explore/v2.1/catalog/datasets?where=title%20like%20%22emploi%22&limit=20`
- `https://opendata.brussels.be/api/explore/v2.1/catalog/datasets?where=title%20like%20%22offre%22%20or%20title%20like%20%22job%22%20or%20title%20like%20%22vacature%22&limit=20`
- `https://data.gov.be/en/search?query=vacatures`
- `https://www.stepstone.be/robots.txt`
- `https://references.be/robots.txt`
- `https://jobs.references.be/robots.txt`
- `https://www.jobat.be/robots.txt`
- `https://www.jobat.be/sitemaps/sitemap.xml`
- `https://www.talent.io/robots.txt`
- `https://eu-careers.europa.eu/en/job-opportunities/in-progress`
- `https://eu-careers.europa.eu/jsonapi`
- `https://economie-emploi.brussels/permis-unique-carte-bleue-annexes`

## Main-session audit, 2026-09-04

The agent was right to flag the Le Forem question rather than settle it
alone. Both halves are now resolved, and neither goes our way.

**Le Forem — SKIP.** `www.leforem.be/robots.txt` names ClaudeBot explicitly
with `Disallow:/` (GPTBot too; LinkedInBot and facebookexternalhit are
allowed, so the ban is a deliberate choice, not a blanket). The open-data API
does live on a different host, but that host's robots disallows `/api/` for
every agent — which is the exact path the adapter would use. Two independent
signals, both saying stay out; taking 25,917 postings anyway would be routing
around a ban through a side door.

**Actiris — PARK, and the reason is our own schema, not their robots.**
Actiris is genuinely open: its robots.txt is 386 bytes containing nothing but
`Sitemap:` lines, including `sitemapoffers-fr.xml` dedicated to job offers —
9,643 URLs with same-day `lastmod`, server-rendered, an `<h1>` title and a
3,326-character body in ordinary paragraphs. But it **does not publish the
employer name**: checked across three postings, no employer field exists in
any form, because applications route through the agency. `company` is
load-bearing here — it is half of the dedupe content key, the join to the
sponsor registers, the seed for the name probe, and the second line of every
card. Ingesting 9,643 rows whose company is "?" would corrupt dedupe and
contribute nothing to the sponsorship axis this radar is built around. If the
product ever widens past sponsorship, revisit: the door is open and the
bodies are real.

So Belgium is honestly thin for us despite having two working public doors —
one we may not use, one we cannot use well. The private boards are WAF-walled
(StepStone.be, References.be, Jobat), Talent.io is defunct, and no Belgian
region publishes a single-permit employer register. VDAB remains our only
Belgian source, and it covers Flanders only.
