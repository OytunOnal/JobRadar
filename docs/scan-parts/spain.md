# Spain source scan

Scope: Spanish-market job sources for a candidate needing **visa sponsorship**
(profesional altamente cualificado under Ley 14/2013, or the *empresa emergente*
route opened by the Startup Law, Ley 28/2022). Scanned 2026-09-02. Every yes/no
below was decided by fetching the URL in the row with a browser User-Agent, not
by reading a marketing page. Sources already in the registry (Manfred, EURES,
Adzuna, JSearch, LinkedIn, the 30 ATS adapters, …) are out of scope and are only
named where a Spanish board turned out to be downstream of one.

**Headline difference from the Netherlands scan:** Spain publishes no employer
whitelist. There is no Spanish equivalent of the IND register — the UGE-CE
(Unidad de Grandes Empresas y Colectivos Estratégicos) accredits companies to
fast-track highly qualified professionals but does **not** publish the list of
accredited employers; its own site
(`https://www.inclusion.gob.es/en/web/unidadgrandesempresas/sobre-nosotros`)
describes the unit's remit and names no companies. The nearest thing is the
ENISA register of certified *empresas emergentes*, and that one is locked
behind a Power BI embed (row below). So Spain has to be won on job feeds, not
on a register lookup.

## Verdict table

| Board / service | Type | Machine door? | Verified URL | Visa relevance | Verdict |
|---|---|---|---|---|---|
| **SpainJobs.io** | Visa/expat-focused Spanish aggregator, English-first | **Yes, and the cleanest found.** `robots.txt` is `Allow: /` with `Content-Signal: search=yes, ai-input=yes`; sitemap index → `jobs-0.xml` with **40 000** `<loc>` (plus `jobs-1.xml`) and `companies.xml` with **2 233**, every entry ISO-8601 `lastmod`, index `lastmod` `2026-09-02T17:24:19Z`; detail pages server-rendered with `application/ld+json` `JobPosting` | `https://www.spainjobs.io/robots.txt`; `https://www.spainjobs.io/sitemap.xml`; `https://www.spainjobs.io/sitemap/jobs-0.xml` (200, 40 000 locs); `https://www.spainjobs.io/sitemap/companies.xml` (200, 2 233 locs); detail `https://www.spainjobs.io/companies/011h/encargadoa-de-obra--3e5fe3fc62` (200, JSON-LD JobPosting true) | **Highest found.** It ships two curated visa surfaces: `https://www.spainjobs.io/companies/visa-sponsors` (200, `<title>` = *"16 Companies in Spain That Sponsor Visas (123 open roles)"*, links Affirm, N26, Revolut, Palo Alto Networks, Scopely, Multiverse Computing, GFT, Talan …) and `https://www.spainjobs.io/visa-jobs` (200, *"Visa & Work Authorization Jobs in Spain (2026)"*, body: *"visa and work-route jobs in Spain from 19 companies with a verif…"* and *"explicitly names GECCO or recruitme…"*) | **Adapter-worthy (top pick)** — sitemap + JSON-LD, no key, robots explicitly permits AI input. Caveat: `/api/` and `/jobs/search?` are `Disallow`ed, and the 40 k pool is a general aggregate (the sampled detail was a construction supervisor), so ingest the whole sitemap but treat `/visa-jobs` + `/companies/visa-sponsors` as a **sponsorship label source**, which is the part nothing else in the registry gives us for Spain |
| **JobsinBarcelona.es** (JobsinNetwork) | English-language board for Barcelona/Spain | **Yes** — `robots.txt` has no `Disallow` at all and names the index; `sitemap_index.xml` → `livejobs.xml` with **10 000** job URLs, all `lastmod 2026-09-02`; detail pages server-rendered | `https://jobsinbarcelona.es/robots.txt` (200, `User-agent: *` + `Sitemap:` only); `https://jobsinbarcelona.es/sitemap_index.xml` (200, 9 sitemaps); `https://www.jobsinbarcelona.es/sitemap/livejobs.xml` (200, 10 000 locs); detail `https://www.jobsinbarcelona.es/jobs/ai-engineer/81de42b2a5d6601ed0bab2baf35d739e` (200, `<title>AI Engineer - JobsinBarcelona`, schema.org **microdata** `itemprop="name"` / `itemprop="description"`, employer Sabio Group) | High by construction — the board's stated audience is *"professionals and expats seeking employment opportunities with English as the main working language"*; no explicit sponsorship flag though | **Adapter-worthy (second)** — parse the microdata, not JSON-LD (`"@type":"JobPosting"` is **absent**). Job URLs in the sitemap carry a `?jlt=` token that is not needed to fetch |
| **NextLevelJobs.eu — Spain slice** | Visa/relocation tech board, already verified EU-wide | **Yes**, at country granularity: `https://nextleveljobs.eu/country/es` returns 200, server-rendered, `<title>` = *"€100k+ Software Engineering Jobs in Spain"*, 15 `/companies/*/jobs/*` links on the first page (N26, Elastic). **`https://nextleveljobs.eu/city/barcelona` returns HTTP 500** — the city route is broken for Barcelona, so enumerate Spain via `/country/es` and the global jobs sitemap, not per-city | `https://nextleveljobs.eu/country/es` (200); `https://nextleveljobs.eu/city/barcelona` (**500**) | High — sponsorship/relocation is the board's premise; page also states *"No sponsored listings. No recruiter noise."* | **Already adapter-approved EU-wide** — Spain needs no separate adapter; just do not build a per-city Barcelona path |
| **Domestika jobs** | Creative/design community board, Spain-heavy | **Yes** — `robots.txt` open and publishes `sitemapindex.xml`; `sitemap-jobs-1.xml` returns 200 with **288** job URLs, each with `lastmod` (Aug 2026) and `changefreq daily` | `https://www.domestika.org/robots.txt`; `https://www.domestika.org/sitemapindex.xml`; `https://www.domestika.org/es/sitemap-jobs-1.xml` (200, 288 locs; e.g. `…/jobs/56729-diseno-web-ux-ui-practicas-madrid-espana`) | Low — sampled titles are *diseñador gráfico*, *diseño web UX/UI prácticas*, Spanish-language, Madrid/Barcelona internships and design roles. No sponsorship signal | **Park** — legal, tiny (288), and off-discipline. Only worth it if design/UX ever enters the profile |
| **SEPE — Empléate** (`empleate.gob.es`) | National public employment portal | **No verified door.** `robots.txt` is `Allow: /`, and `sitemap.xml` is a 53-entry index — but every `<loc>` inside is an AngularJS **hash-fragment search URL**, e.g. `https://empleate.gob.es/empleo/#/trabajo?search=*&pag=0&provinciaF=BARCELONA`. Zero per-offer URLs. The SPA bundle references Solr-backed REST routes (`open/offersearch/select`, `open/offersearch/selectBuscador`, `open/publicoffersearch/`, `open/offersearch/getById`) behind a runtime-injected `pueRestPrefix`; four prefix candidates (`/empleo/rest/`, `/rest/`, `/empleo/services/`, `/pue-rest/`) **all returned the server's 404 page** | `https://www.empleate.gob.es/robots.txt` (200); `https://empleate.gob.es/sitemap.xml` (200, 53 sitemaps); `https://empleate.gob.es/empleo/sitemap/sitemap_bcn.xml` (200, 155 locs — all hash-fragment searches); `https://empleate.gob.es/empleo/js/app.min.js.gz?14.3.33` (200, 1 036 654 bytes, contains `SOLR_URL:pueRestPrefix+"open/offersearch/"`); probes `https://empleate.gob.es/empleo/rest/open/offersearch/select?q=*:*&wt=json` → **404** | n/a — and note the portal's own `<meta name="description">` calls it *"agregador de ofertas de trabajo de portales de empleo"*, i.e. an aggregator over other Spanish portals rather than a primary SEPE vacancy feed | **Already covered via EURES** (park the Solr lead) — a keyless JSON search API almost certainly exists one path segment away; if someone ever wants it, read `pueRestPrefix` off a live browser network tab rather than guessing |
| **SEPE open data** (`sede.sepe.gob.es` / datos.gob.es) | Official open dataset catalogue | Datasets exist, **wrong shape** — the catalogue lists only aggregates: *Contracts registered by municipalities*, *Job seekers by municipalities*, *Expenditure on unemployment benefits*, *Registered unemployment by municipalities*. No vacancy-level dataset (no employer, title or description) | `https://sede.sepe.gob.es/portalSede/en/datos-abiertos/catalogo-de-datos-del-SEPE` (200); portal record `https://datos.gob.es/es/iniciativas/portal-datos-abiertos-sepe` | None | **Skip** — labour-market statistics, not a job source. **DIRECT access adds nothing over the EURES mirror we already ingest** |
| **sepe.es** (main site) | Public employment service site | **No** — `robots.txt` ends with a blanket `Disallow: /*?` plus `Disallow: /*.pdf$ /*.xls$ /*.xlsx$`, killing every query-string search URL and every tabular download | `https://www.sepe.es/robots.txt` (200, 1 712 bytes) | n/a | **Already covered via EURES** |
| **ENISA register of certified *empresas emergentes*** | Statutory registry of Startup-Law-certified companies (2 100+ certified as of Mar 2026) | **No.** `robots.txt` is fully open (`Disallow:` empty) but the register itself is a **Microsoft Fabric / Power BI iframe** — `https://app.fabric.microsoft.com/view?r=eyJrIjoiNjY0YjVkNTktMjg3Yy00YmI1LTljN2ItMjRmZjIwOTUyM2NiIi…` under `<section id="buscador-certificaciones">`. Zero `<table>` elements, zero `<tr>`, no CSV/XLSX link, no API in the page. The old documented URLs `…/es/certifica-tu-startup/startups` and `…/empresas-certificadas` both **404** (the site was restructured to `/servicios/certificacion/`) | `https://www.enisa.es/robots.txt` (200); `https://www.enisa.es/sobre-enisa/consuta-datos-publicos/` (200, Fabric iframe, description: *"Consulta las certificaciones concedidas por Enisa en el marco de la Ley 28/2022 … Filtra por año, sector o comunidad autónoma"*); `https://www.enisa.es/es/certifica-tu-startup/startups` (**404**) | **Would be the highest-value item in the scan** — Startup-Law certification is the legal gateway to the *empresa emergente* visa regime, exactly the Spanish analogue of the IND register | **Park** — right data, no door. Revisit only if someone is willing to drive the Power BI embed or the `registradores.org` form (`https://www.registradores.org/en/empresas-emergentes-enisa`, a search form, no export) |
| **InfoJobs** | Largest Spanish generalist board | **Keyed, and the terms forbid our use.** The REST API at `api.infojobs.net` requires a registered Client ID + Secret over HTTP Basic (OAuth2 Bearer for user-scoped calls). The terms require a **Partner agreement** for any app that *stores or exports InfoJobs data*, exceeds 250 000 daily calls or 50 000 MAU; they state *"Nunca serás propietario de los datos de InfoJobs"* and prohibit *creating competing job portals*. Separately, `robots.txt` disallows the offer surfaces themselves (`/ver-oferta.xhtml`, `/visualizar_oferta.ij/`, `/ofertas_lista.cfm`, `/buscar.empleo/`) | `https://developer.infojobs.net/legal/legal/terms-of-use.xhtml`; `https://www.infojobs.net/robots.txt` (200, 4 550 bytes) | Medium volume-wise, none sponsorship-wise | **Skip** — a local-first tool that persists postings *is* the "storing or exporting" case that needs a Partner agreement, and is arguably the "competing portal" case too. Both doors (API and crawl) are shut for us |
| **Tecnoempleo** | The Spanish IT board — best content fit on paper | **No — refused by robots, by name.** `robots.txt` carries `User-agent: ClaudeBot / Disallow: /`, and the same for `AnthropicBot`, `Claude`, `anthropic-ai`, `Claude-Web`, `Claude-SearchBot`, `GPTBot`. It also `Disallow`s `/alertas-empleo-rss.php` for everyone, so the RSS feed is off-limits too | `https://www.tecnoempleo.com/robots.txt` (200, 953 bytes) | Would have been high (pure Spanish IT employers, Madrid/Barcelona) | **Skip** — refused by robots. The single biggest loss in this scan |
| **JobFluent** | Startup/tech board, Barcelona + Madrid focus | **No — refused by robots, by name.** `User-agent: ClaudeBot / Disallow: /` (also GPTBot, ChatGPT-User, CCBot, Bytespider); `/api/*` disallowed for everyone | `https://www.jobfluent.com/robots.txt` (200, 627 bytes) | Would have been high (Barcelona/Madrid startup roles, English listings) | **Skip** — refused by robots |
| **JobsinMadrid.com** | Sister site of JobsinBarcelona | Ambiguous — `robots.txt` is 66 bytes containing only `User-agent: *` with **no rules and no `Sitemap:` line**, unlike its Barcelona sibling | `https://jobsinmadrid.com/robots.txt` (200, 66 bytes) | Same audience as JobsinBarcelona | **Park** — if the JobsinBarcelona adapter works, try `…/sitemap_index.xml` on this host by analogy; nothing was verified here |

## Checked, not worth it

- **Empleo IT** — both `https://www.empleo-it.com/robots.txt` and
  `https://empleoit.com/robots.txt` fail at the network layer (`fetch failed`,
  DNS/connection, not an HTTP status). The brand does not resolve to a live
  host. Nothing to scan.
- **UGE-CE accredited-employer list** — searched for and not found. The unit's
  own pages
  (`https://www.inclusion.gob.es/en/web/unidadgrandesempresas/sobre-nosotros`)
  describe the Ley 14/2013 remit — entrepreneurs, highly qualified
  professionals, researchers, intra-company transfers, remote workers — and name
  strategic sectors, but publish no register of accredited companies. Every
  "list of companies that sponsor visas in Spain" hit was a law-firm or blog
  listicle, not a primary source. **There is no Spanish IND register to ingest.**
- **datos.gob.es vacancy datasets** — the employment theme surfaces
  `Ofertas de empleo Sistema Portuario`
  (`https://datos.gob.es/en/catalogo/ea0001277-ofertas-de-empleo-sistema-portuario`)
  and similar: these are *oposición*/public-competition calls for port-authority
  and civil-service posts, which are closed to non-EU candidates without prior
  residence and are not tech. Skip.
- **ENISA via registradores.org** —
  `https://www.registradores.org/en/empresas-emergentes-enisa` confirms a public
  consultation tool exists (*"Utilizando la siguiente herramienta podrá
  consultar las empresas emergentes certificadas como tales por ENISA"*) but
  offers a search form with no CSV/XLSX/PDF export and no documented endpoint.
  Same data as the Power BI row, same verdict.
- **Domestika sitemap for tech** — the jobs sitemap is real, but the site's other
  17 sitemaps are courses, projects, users and forums. There is no separate
  engineering feed; 288 creative postings is the whole job surface.
- **Empléate `sitemap_home.xml` / per-province files** — checked `sitemap_bcn.xml`
  as the representative sample (155 locs, Barcelona). All 53 province files
  follow the identical `#/trabajo?search=*&pag=0&provinciaF=…&categoria=NN`
  template, so none of them enumerate offers. No point fetching the other 52.

## Note on what Spain actually gives us

The Netherlands scan found a register and treated the boards as a bonus. Spain
inverts that. The two registries that would matter — UGE-CE accreditations and
ENISA Startup-Law certifications — are respectively unpublished and trapped in a
Power BI embed, so the "does this company sponsor?" question cannot be turned
into a lookup here.

What Spain does give us is a board that has already done the labelling by hand:
SpainJobs.io ships an explicit, dated, server-rendered list of employers
sponsoring visas in Spain alongside a 40 000-posting sitemap with JSON-LD, under
a `robots.txt` that names AI input as permitted. That is a sponsorship *label*
we can join onto postings we already ingest from the ATS adapters — the same
precision gain the IND register buys in the Netherlands, sourced from a private
curator instead of a ministry. Everything else in this scan is volume, and two
of the three best-fitting Spanish tech boards (Tecnoempleo, JobFluent) have
closed the door on us by name.
