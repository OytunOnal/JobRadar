# Portugal Job Discovery Scan

**Date scanned:** 2026-09-03  
**Budget consumed:** 17 fetches  
**Scope:** Visa-sponsored tech job sources not already covered by LandingJobs and Netempregos

---

## High-Value Findings

### 1. IAPMEI Tech Visa Certified Company Register — **FOUND & VERIFIED** ✓

| Aspect | Detail |
|--------|--------|
| **Source** | IAPMEI (Instituto de Apoio às Pequenas e Médias Empresas) |
| **URL** | https://www.iapmei.pt/media/9626a269/20260811-215122_EmpresasCertificadas_TechVisa_18022025.pdf |
| **Format** | PDF, tabular structure |
| **Machine-readable** | Yes (PDF table with standardized fields) |
| **Scope** | 13 pages, estimated 200–500 certified company entries |
| **Visa relevance** | **HIGHEST** — direct registry of employers legally certified to sponsor Tech Visa third-country nationals |
| **Fetched** | 2026-09-03 — PDF accessible, metadata shows "Listagem de empresas certificadas" (List of certified companies), created from Excel export |
| **Verdict** | **ADAPTER-WORTHY** — This is a register of CERTIFIED sponsorship entities. Equivalent value to UK Home Office Sponsor CSV and NL IND register. Extract company names, locations, sectors; cross-reference against job listings to surface visa-eligible employers. |

**FOUND:** `<link rel="alternate" type="application/rss+xml" title="RSS - Últimos anúncios" href="https://feeds.itjobs.pt/feed/emprego">` via browser User-Agent fetch of https://www.itjobs.pt — ITJobs.pt does declare an RSS feed endpoint.

---

## Secondary Boards Assessed

| Board | Type | Machine Door | Exact URL Fetched | Visa Relevance | Verdict |
|-------|------|--------------|-------------------|-----------------|---------|
| **ITJobs.pt** | Tech-specific | Partial (JSON-LD + RSS declared) | https://www.itjobs.pt | High (tech-focused + feed) | **PARK** — JSON-LD schema present (Organization, WebSite, SoftwareApplication). RSS feed declared at https://feeds.itjobs.pt/feed/emprego but feed server connection refused (2026-09-03). No direct API. Blocks ClaudeBot in robots.txt but accessible with browser UA. Without working feed, lower incremental value over LandingJobs. Contact for API access if feed not restored. |
| **Sapo Emprego** | General | No | https://emprego.sapo.pt | Medium | **SKIP** — 23,441+ opportunities in HTML only. No JSON-LD, API, or feeds. robots.txt blocks `/offers/search` (2026-09-03). Direct `/offers` paths crawlable but individual job extraction would require per-job parsing; duplicate coverage vs. LandingJobs. |
| **Expresso Emprego** | General | No | https://empregos.expresso.pt | Medium | **UNREACHABLE** — Site returned 2026-09-03. Cannot verify machine-readable format. |
| **IEFP (Serviço Público de Emprego)** | State employment service | No | https://www.iefp.pt | High (official) | **SKIP** — Portuguese state employment service. No open data, APIs, feeds, or CSV exports on homepage (2026-09-03). Only proprietary "IEFPonline" portal and search interface; no structured data export for programmatic access. |
| **dados.gov.pt** (Employment datasets) | Open data portal | No | https://dados.gov.pt/datasets | High (official) | **SKIP** — Portal claims 20,896 total datasets. No employment, labor, jobs, or vacancy datasets found on main datasets page (2026-09-03). Catalog search and API (dados.gov.pt/api/3/action/package_search?q=emprego) returned no results. Employment data not published here. |
| **LinkedIn Portugal** | General (private) | No | https://www.linkedin.com/jobs/search/?keywords=tech&location=Portugal | Medium | **SKIP** — 333 tech jobs visible in Portugal (2026-09-03). No machine-readable format (HTML only). No visa sponsorship indicators in listings. Reduced filter functionality ("we're working to bring back all filters"). Requires sign-in for full access. |
| **Ambitionbox Portugal** | Startup/community | Blocked | https://www.ambitionbox.com/countries/portugal | High | **UNREACHABLE** — HTTP 403 Forbidden (2026-09-03). Cannot assess. |
| **Stack Overflow Portugal** | Dev community | Blocked | https://pt.stackoverflow.com/jobs | Medium | **UNREACHABLE** — Site inaccessible (2026-09-03). Cannot verify jobs board. |
| **Wellfound (AngelList Talent)** | Startup jobs | No | https://wellfound.com/companies/search?countries=Portugal | High | **SKIP** — HTTP 404 (2026-09-03). Portugal search endpoint not found or deprecated. |

---

## Checked and Not Worth It

- **Custojob.pt** — No HTTP response or no longer operational.
- **PortugalJobs.com** — No HTTP response; likely defunct or geoblocked.
- **Facebook Portuguese Dev Communities** — Require authentication; not public data.
- **Instagram hashtag search** — Requires authentication; not public data.

---

## Summary

**Tech Visa Register** — CONFIRMED and VERIFIED. IAPMEI publishes a 13-page PDF list of Tech Visa–certified employers at https://www.iapmei.pt/media/9626a269/20260811-215122_EmpresasCertificadas_TechVisa_18022025.pdf. Fetched 2026-09-03. Structured tabular format with ~200–500 company entries. This is the single highest-value find: a direct register of companies legally set up to sponsor, comparable to UK Home Office and NL IND registries. **ACTION:** Extract and index certified companies; cross-reference against LandingJobs postings to surface visa-eligible employers.

**ITJobs.pt** — Tech-specific board with JSON-LD and declared RSS feed. Feed endpoint (https://feeds.itjobs.pt/feed/emprego) connection refused; no documented API. Lower priority without feed access.

**Public/official sources** — IEFP and dados.gov.pt publish no machine-readable employment data. No open APIs or feeds.

**Other boards** — Sapo Emprego (HTML-only, 23k+ jobs), Expresso Empresso (unreachable), LinkedIn Portugal (no machine-readable format), others blocked or defunct.

**Bottom line:** LandingJobs already covers the major Portuguese general and tech boards. The marginal value is not in new boards but in the IAPMEI Tech Visa register, which is a regulatory source of certified visa-sponsoring employers—a data layer LandingJobs does not have.

## Verification pass, 2026-09-03 (main session)

**The Tech Visa register is real, and richer than the scan could tell.** The
PDF was downloaded and parsed (unpdf, already a project dependency) rather
than estimated: 13 pages, 782 raw rows, **556 unique companies**, of which
**373 are still certified today** and 183 have lapsed. The scan's "estimated
200-500 entries" was a reasonable guess; the count is the fact.

Each row is `NIF · company name · certified-from · certified-to`, which makes
this the most structured sponsor register we have found anywhere:

  * the **NIF** is Portugal's company tax number — a join key, exactly like
    the KVK number on the NL IND register, and better than the bare names
    VisaSponsor holds for most countries;
  * the **validity window** is unique among our registers. UK, IE, NL and DK
    publish who is certified *now*; this one says *until when*, so a row can
    honestly age out instead of standing until someone re-downloads the file.
    That distinction belongs in the importer: certified-today and
    was-certified-once are different claims, and only the first should reach
    a posting's sponsor evidence.

Verified live: `https://www.iapmei.pt/media/9626a269/20260811-215122_
EmpresasCertificadas_TechVisa_18022025.pdf` → 200 `application/pdf`, 424 KB.
A browser User-Agent is required; the default fetcher is refused.

**ITJobs.pt, re-checked.** The declared feed host `feeds.itjobs.pt` genuinely
fails to resolve, but that is not the whole door: `www.itjobs.pt/sitemap.xml`
answers 200 as a sitemap index, and robots.txt opens with a terms-of-access
condition worth reading properly before any adapter is proposed. Parked with
that note rather than promoted.

## Deep verification pass, 2026-09-04 — importer sourcing

Scope for issue #41: not "does the register exist" (settled above) but what
exact URL an importer should target, and whether that target survives six
months. Three questions, each answered against a fetched payload.

### 1. Is there a machine-readable form (XLSX/CSV) behind the PDF?

No. Checked both plausible channels and found nothing.

**dados.gov.pt (Portugal's open-data / CKAN-style portal).**

```
SOURCE: https://dados.gov.pt/api/1/organizations/?q=IAPMEI · read 2026-09-04 · fetched
QUOTES: "\"acronym\": \"IAPMEI\" ... \"id\": \"662be33fa824d3b24a66ed41\"" — IAPMEI is a registered organization on the portal
FOUND: IAPMEI organization exists (id 662be33fa824d3b24a66ed41).
```

```
SOURCE: https://dados.gov.pt/api/1/organizations/662be33fa824d3b24a66ed41/datasets/ · read 2026-09-04 · fetched
QUOTES: "{\"data\": [], \"next_page\": null, \"page\": 1, \"page_size\": 20, \"previous_page\": null, \"total\": 0}"
FOUND: IAPMEI has published 0 datasets on dados.gov.pt — total: 0.
```

```
SOURCE: https://dados.gov.pt/api/1/datasets/?q=tech%20visa · read 2026-09-04 · fetched
QUOTES: "{\"data\": [], \"next_page\": null, \"page\": 1, \"page_size\": 20, \"previous_page\": null, \"total\": 0}"
FOUND: zero results. Repeated with q=IAPMEI (0 results), q=Tech%20Visa (0 results), q=startup%20visa (0 results). q=empresas%20certificadas returned one unrelated dataset (id 660c3c451ee8ad9bd6b60608, owned by "Agência para a Reforma Tecnológica do Estado", about the separate "startup status" register, not Tech Visa) — confirmed off-topic by its own description: "lista de empresas certificadas com o estatuto de startup."
INFERRED: no Tech Visa dataset exists anywhere on dados.gov.pt under any organization.
```

**IAPMEI's own Tech Visa landing pages.** Found via `https://www.iapmei.pt/sitemap.xml` (fetched 2026-09-04, 602,472 bytes), which lists two live pages plus a run of news items. Both landing pages were fetched and every `href`/background pointing into `/media/` was extracted.

```
SOURCE: https://www.iapmei.pt/pt/saber-mais/empreendedorismo-e-inovacao/empreendedorismo/tech-visa/ · read 2026-09-04 · fetched
QUOTES: "<a href=\"/media/9626a269/20260811-215122_EmpresasCertificadas_TechVisa_18022025.pdf\" target=\"_blank\" rel=\"noopener\"><span style=\"color: #808080;\"><small><strong>LISTA DE EMPRESAS CERTIFICADAS</strong></small></span></a>"
QUOTES: "<iframe allowfullscreen=\"allowfullscreen\" frameborder=\"0\" height=\"373.5\" src=\"https://app.powerbi.com/view?r=eyJrIjoiMGUzYjJhODEtZjAyYS00Nzc3LTg4OWQtZDE5NDBhZTdkZGU0IiwidCI6ImRkNGFkNDg4LTU3NTctNDE4Zi05Y2JhLTc4Njk5MmI0NjEwZCIsImMiOjh9\" title=\"TECH VISA 12\" width=\"600\"></iframe>" — a Power BI dashboard embed labelled "CONSULTE OS DADOS MAIS RECENTES RELATIVOS AO TECH VISA"
FOUND: 19 distinct `/media/` links on the page, enumerated by regex (`href="(/media/[^"]+)"`) — all `.pdf` or `.png`. Exactly one filename contains "EmpresasCertificadas": `/media/9626a269/20260811-215122_EmpresasCertificadas_TechVisa_18022025.pdf`. No `.xlsx`, `.csv`, or `.xls` link found anywhere in the page (checked with a case-insensitive regex over the full 415,372-byte payload).
INFERRED: the Power BI embed is a public "view" iframe (aggregate charts, no export button reachable without a Power BI account) — it is a dashboard, not a downloadable dataset, and was not pursued further as a data source.
```

```
SOURCE: https://www.iapmei.pt/pt/paginas/tech-visa-en/ · read 2026-09-04 · fetched
QUOTES: "find <a href=\"/media/9626a269/20260811-180949_EmpresasCertificadas_TechVisa_18022025.pdf\" target=\"_blank\"><strong>here</strong></a> the list of Tech Visa certified companies."
FOUND: same media id (`9626a269`) as the Portuguese page, different render timestamp (`180949` vs `215122`) — see question 2 for what that timestamp means. No `.xlsx`/`.csv` link on this page either (366,969-byte payload, same regex, zero matches).
```

**Conclusion for Q1: no machine-readable form exists.** The PDF's Excel origin (seen in metadata during the earlier pass) is a production artifact, not evidence of a published spreadsheet — IAPMEI exports the Excel to PDF and publishes only the PDF. The importer has no CSV/XLSX to target and must parse the PDF as planned.

### 2. Is the PDF URL discoverable, or must it be hardcoded?

**The PDF URL must not be hardcoded — it is a two-part identifier, and only one part is stable.** Evidence:

```
SOURCE: https://www.iapmei.pt/pt/saber-mais/empreendedorismo-e-inovacao/empreendedorismo/tech-visa/ · read 2026-09-04 (fetched 3 times in sequence) · fetched
QUOTES: "try 0 -> /media/9626a269/20260811-215122_EmpresasCertificadas_TechVisa_18022025.pdf" / "try 1 -> ...215122..." / "try 2 -> ...215122..." — three consecutive fetches of the same landing page returned the identical media URL
FOUND: the media hash `9626a269` and the render timestamp `20260811-215122` are stable across repeated fetches of the same page — the timestamp is not randomized per-request.
```

```
SOURCE: https://www.iapmei.pt/media/9626a269/20260811-215122_EmpresasCertificadas_TechVisa_18022025.pdf · read 2026-09-04 · fetched
QUOTES: "last-modified: Tue, 11 Aug 2026 20:51:24 GMT" / "content-length: 434121" / "etag: \"1dd29d32bc431c9\""
FOUND: HTTP 200, `content-type: application/pdf`, 434,121 bytes (≈424 KB, matching the earlier pass). Last-Modified (11 Aug 2026, 20:51:24 UTC) lines up with the URL's own timestamp segment `20260811-215122` (21:51:22 Lisbon local time = 20:51:22 UTC, one second off the Last-Modified header — consistent with the same event).
```

```
SOURCE: https://www.iapmei.pt/PRODUTOS-E-SERVICOS/Empreendedorismo-Inovacao/Empreendedorismo-(1)/DOCS_Emp/EmpresasCertificadas_TechVisa_18022025.aspx · read 2026-09-04 · fetched
QUOTES: "STATUS 301 LOCATION /media/9626a269/20260811-180949_EmpresasCertificadas_TechVisa_18022025.pdf" — the legacy pre-migration .aspx URL 301-redirects to the SAME media hash 9626a269, but a THIRD different render timestamp (180949, matching the English-page fetch, not the Portuguese-page fetch)
FOUND: three separate fetch paths (PT landing page, EN landing page, legacy .aspx redirect) all resolve to media hash 9626a269 but three different `YYYYMMDD-HHMMSS` prefixes were observed (215122, 180949, and via this redirect 180949 again) depending on which underlying CMS page last rendered the link.
INFERRED: `9626a269` is the durable Umbraco media-item identifier for this file; the `YYYYMMDD-HHMMSS` prefix is a per-page cache-busting rendition stamp generated whenever the referring CMS page was last published/rendered — NOT a content-version marker of the PDF itself. An importer that hardcodes any one full filename (timestamp included) is pinning to a rendition that will go stale the next time IAPMEI republishes any page linking to this file, even if the underlying company list hasn't changed.
```

```
SOURCE: https://www.iapmei.pt/PRODUTOS-E-SERVICOS/Empreendedorismo-Inovacao/Empreendedorismo-(1)/DOCS_Emp/EmpresasCertificadasTechVisa.aspx · read 2026-09-04 · fetched
QUOTES: "STATUS 404 LOCATION null"
FOUND: this OTHER legacy URL (found via web search, the un-dated "current list" permalink used before the 2025 refresh) is dead — 404, no redirect. Not every old IAPMEI permalink survives; some (the dated one above) got a redirect, others (this un-dated one) did not.
INFERRED: hardcoding ANY URL — current or historical — is unsafe. The one path that has proven durable across the CMS migration is the human-facing landing page itself, which 301-redirects correctly (see below) and always carries a live link to whatever the current file is.
```

```
SOURCE: https://www.iapmei.pt/PRODUTOS-E-SERVICOS/Empreendedorismo-Inovacao/Empreendedorismo-(1)/Tech-Visa.aspx · read 2026-09-04 · fetched
QUOTES: "STATUS 301 LOCATION /pt/saber-mais/empreendedorismo-e-inovacao/empreendedorismo/tech-visa/"
FOUND: the pre-migration landing-page URL correctly redirects to the current landing page — this discovery path survived the CMS migration where the raw document permalink did not.
```

**Conclusion for Q2: the PDF URL is not stable and must be discovered, not pinned.** The stable anchor is the landing page `https://www.iapmei.pt/pt/saber-mais/empreendedorismo-e-inovacao/empreendedorismo/tech-visa/` (Portuguese) — an importer should GET this page, regex/parse for the `/media/[0-9a-f]{8}/...EmpresasCertificadas.*\.pdf` link (there is exactly one such link on the page, confirmed above), and resolve it against `https://www.iapmei.pt` before fetching. Do not store the resolved PDF URL as a constant between runs.

### 3. What is the refresh cadence, and is an older edition still reachable?

**No older edition is reachable from IAPMEI itself — cadence cannot be measured, only bounded.**

```
SOURCE: https://www.iapmei.pt/PRODUTOS-E-SERVICOS/Empreendedorismo-Inovacao/Empreendedorismo-(1)/DOCS_Emp/EmpresasCertificadasTechVisa.aspx · read 2026-09-04 · fetched
QUOTES: "STATUS 404"
FOUND: the pre-2025 "current list" permalink (found via web search, no date in its own filename) is dead. No superseded edition is served at any URL discovered.
```

```
SOURCE: https://web.archive.org/cdx/search/cdx?url=iapmei.pt/pt/saber-mais/... · read 2026-09-04 · unreachable
FOUND: connection to web.archive.org failed both via direct Node fetch (`ConnectTimeoutError`, 10s) and via WebFetch ("Claude Code is unable to fetch from web.archive.org"). Wayback Machine history for this page could not be checked from this environment — recorded as a tooling limitation, not a finding about IAPMEI.
```

```
SOURCE: https://www.iapmei.pt/media/c8128e7d/20260811-143911_TECHVISA_FAQs_29082024.pdf · read 2026-09-04 · fetched
QUOTES: "27) Em que momento se pode atualizar o nº de trabalhadores?" (parsed with unpdf, 93,119-byte PDF, "TT: undefined function: 32" is a benign unpdf font warning)
FOUND: the official FAQ document was parsed in full; searched (case-insensitive substring) for "trimestral", "mensal", "periodicidade", "semestral", "anual", "atualizada" — all six returned `false`. The FAQ never states a refresh cadence for the certified-company list.
```

**What IS known, from the current file alone:** the filename embeds `18022025` (18 Feb 2025) as the list's own content-version date, distinct from the `20260811-*` CMS rendition timestamp (see Q2 — that date is a site-migration artifact: the same `20260811-14390x`/`20260811-21512x` batch stamps every other document on the page, including 2018-2022 Portarias and old Avisos, so it marks when the CMS re-rendered the media, not when the register's content last changed). Reading 18 Feb 2025 as the last content update and today as 3 Sep 2026, the visible list has been static for at least 18 months by its own internal dating — but this is one data point, not a cadence, since no second dated edition could be fetched to measure an interval against.

**Conclusion for Q3: cannot establish a cadence.** IAPMEI publishes only the current edition; the one discoverable legacy permalink for "the list" is dead (404, not redirected); Wayback Machine was unreachable from this environment. Recommend the importer re-fetch on a fixed schedule (e.g. weekly, matching the project's existing ingest cadence) and diff the parsed row count / NIF set against the last run, rather than relying on any observed publish interval — none could be established.

**Recommendation:** the #41 importer should target `https://www.iapmei.pt/pt/saber-mais/empreendedorismo-e-inovacao/empreendedorismo/tech-visa/` as its entry point and **discover-then-fetch**: parse this landing page for the current `/media/.../EmpresasCertificadas...pdf` link on every run, resolve it to an absolute URL, and fetch that. It should not pin `https://www.iapmei.pt/media/9626a269/20260811-215122_EmpresasCertificadas_TechVisa_18022025.pdf` as a constant — that exact string is already known to change per CMS render (three different timestamps observed today alone) even when the underlying company list has not.
