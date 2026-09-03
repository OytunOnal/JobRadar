# Cyprus Job Board Scan

**Date scanned:** 2026-09-03  
**Scope:** Tech job boards, public employment services, Companies of Foreign Interest register, visa sponsorship capability  
**Total fetches:** 7

## Findable Boards & Registers

| Board/Register | Type | Machine Door | URL Fetched | Visa Relevance | Verdict |
|---|---|---|---|---|---|
| ergodotisi.com | Private job board | Sitemap + sitemaps index ✓ | https://ergodotisi.com/sitemap.xml | No visa filter observed | **Adapter-worthy:** ~500 bilingual jobs, scrapeable structure |
| cyprusjobs.com | Private job board | BLOCKED (ClaudeBot) | https://cyprusjobs.com/robots.txt | Unknown (inaccessible) | Skip: Explicitly bans AI crawlers; honour robots.txt ban |
| Companies of Foreign Interest | Government sponsor register | Not found | (Attempted: mof.gov.cy, dol.gov.cy, djc.gov.cy) | HIGHEST VALUE – explicit visa sponsor registry | Skip: NOT published as machine-readable register online |
| PES Cyprus (Public Employment Service) | Government service | Not found | (Attempted: multiple urls) | Unknown | Skip: Domain/service not reliably reachable |

## Verification Details

**ergodotisi.com:**
- **Found:** Sitemap index at https://ergodotisi.com/sitemap.xml with three component sitemaps:
  - jobs.xml (~500 job listings, bilingual: en-CY and el-CY)
  - companies.xml
  - other.xml
- **Found:** Jobs organized as `/jobs/[title]-[id]` with language variants
- **Found:** Each entry includes lastmod date, weekly change frequency, 0.9 priority
- **Found:** Allows crawling for search purposes (robots.txt: no disallows for general crawlers)
- **Found:** Blocks access to `/employee-dashboard/` and `/employer-dashboard/` (private sections)
- **Inferred:** Server-rendered job listings with client-side filtering; no API mentioned
- **Found:** No explicit visa sponsorship or work permit filter visible in main site content
- **Finding:** ~500 Cyprus-based jobs across sectors (accounting, engineering, retail, hospitality, IT, compliance)

**cyprusjobs.com:**
- **CRITICAL FINDING:** Explicitly blocks AI crawlers via robots.txt:
  - User-Agent directives block: ClaudeBot, GPTBot, Google-Extended, Amazonbot, CCBot, meta-externalagent, and others
  - General rule: `"search=yes,ai-train=no,use=reference"` (search indexing allowed, AI training explicitly prohibited)
- **Inferred:** Site owner has made deliberate choice to exclude AI-based discovery
- **Recommendation:** Honour robots.txt ban; do not route around this signal

**Companies of Foreign Interest Register:**
- **Attempted URLs:** https://mof.gov.cy, https://dol.gov.cy, https://djc.gov.cy (Department of Labour / Republic Ministry URLs)
- **Finding:** All unreachable or returned DNS/certificate errors
- **Found:** CSB Group professional services site mentions KEI-equivalent ("Key Employee Initiative" for "highly-specialised third-country nationals")
- **Inferred:** Scheme likely exists as government policy but **NOT published as machine-readable public register**
- **Note:** Cyprus does not appear to maintain an online-published, structured registry of approved visa sponsors (equivalent to UK Licensed Sponsors list or UAE employer register)

## Market Size & Conclusion

Cyprus is the most English-accessible market (island economy, tourism/finance sector) but visa sponsorship discovery is sparse:
- 1 private board with strong machine door (ergodotisi.com) scrapeable via sitemap, ~500 jobs listed
- 1 board (cyprusjobs.com) explicitly blocks AI access – honour this by not attempting scrape
- No published, machine-readable Companies of Foreign Interest sponsor register
- Public employment service unreachable/unclear
- No visa sponsorship metadata visible on either board

**Adapter Opportunity:** ergodotisi.com is the strongest technical target (bilingual, ~500 jobs, open sitemap) but lacks visa field data.

**Recommendation:**
1. **Pursue ergodotisi.com ingest:** Bilingual job board with open sitemap. Could ingest as "visa status unknown" and rely on employer site crawl for sponsor detection. Most viable single board across all three countries.
2. **Skip cyprusjobs.com:** Explicitly blocks AI crawlers; respect the bot policy.
3. **Investigate Companies of Foreign Interest register:** Query Republic of Cyprus Department of Labour whether a public register of approved visa sponsors exists in ANY format (HTML page, XLSX, JSON open data). If published, it would be the highest-value discovery across all three countries and outrank all job board ingest.

## Verification pass, 2026-09-03 (main session)

**Ergodotisi holds up, and is an order of magnitude bigger than reported.**
The scan estimated ~500 listings; the fetched sitemap carries **5,166** job
URLs (`https://ergodotisi.com/sitemap/jobs.xml`, 1.06 MB, newest `lastmod`
dated the day of the scan). robots.txt is 190 bytes and permits crawling.

Detail pages are server-rendered but carry **no JSON-LD** — the scan did not
claim otherwise, and a check confirms it: 81 KB of HTML, 15.5 KB of extracted
text, no `JobPosting` block, no `__NEXT_DATA__`, no Nuxt payload. What they do
carry is a title in a strict, parseable form — `<title>Store Manager at The
Biscuit Corner - MyCookieDough | Ergodotisi</title>` — plus an
`og:description`. So an adapter here is a bespoke title/og parse, the
huntukvisa and visajobsie shape, not a JSON-LD lane.

One caveat the sample makes plain: the sampled listing is retail
("Store Manager"), so this is a **generalist** board in a small market. The
tech slice of 5,166 is modest, and the keyword scorer will do most of the
filtering. Its real appeal is structural — Cyprus is an EU market whose
working language is English, so its postings clear the language barrier that
filters most of this radar's pool.

**No Companies of Foreign Interest register found**, matching the scan.
Recorded as an evidenced negative rather than a lead to retry.

## Deep verification pass, 2026-09-04

**Verdict: CONFIRMED — no public list of Companies of Foreign Interest exists.** The register is explicitly held internally by the Business Facilitation Unit (BFU), not published. This settles the 2026-09-03 negative with a direct quote rather than an inference from unreachable URLs.

```
SOURCE: https://www.gov.cy/meci/en/business-facilitation-unit-bfu/ · read 2026-09-04 · fetched
QUOTES: "The BFU accepts applications from companies wishing to be registered in the Register of Companies with Foreign Interests; held at the Unit. By registering in the Register, companies can take advantage of the incentives announced by the Government, regarding the employment of third country nationals." — text extracted verbatim from the fetched page HTML
FOUND: HTTP 200 (curl, browser UA, 31,441-byte HTML). No link on the page to a list, register export, or search tool — the register is described as "held at the Unit," i.e. an internal administrative record, not a public dataset. Zero links matching list/register/foreign/.pdf/.xlsx/.csv found in the page's href attributes
INFERRED: The register's existence is government-confirmed; its non-publication is also government-confirmed by omission — a public body describing its own register as "held at the Unit" with no companion "see the list here" link is affirmative evidence of non-publication, not just absence of a URL found

SOURCE: https://www.businessincyprus.gov.cy/ · read 2026-09-04 · fetched
FOUND: HTTP 200. This is the BFU's public-facing portal (the "official website for applications" per prior research). All 100 extracted links were enumerated; none reference a companies-of-foreign-interest list, register, or directory. Site structure is "operating permits" organized by business sector (agriculture, construction, tourism, etc.) — an application/guidance portal, not a registry
INFERRED: Confirms businessincyprus.gov.cy is where a company applies for CFI status, not where an approved list would be published

SOURCE: https://www.investcyprus.org.cy/ · read 2026-09-04 · fetched
FOUND: HTTP 200. Homepage and its "publications" section link (`/publications/`, redirect confirmed) were checked for any company directory or list; none found in the extracted link set
INFERRED: Invest Cyprus is a promotion/investor-relations body; it does not publish the CFI register either
```

**Cyprus Registrar of Companies — searchable-only interface, not a downloadable list. A different answer from "no list exists": a list of all Cyprus companies exists, but only as a per-record, one-at-a-time, fee-gated lookup, and it is a general company registry, not the visa-relevant CFI register.**

```
SOURCE: https://www.companies.gov.cy/en/21-eservices/esearch-in-business-entity-s-registry · read 2026-09-04 · fetched
QUOTES: "eServices, eSearch in Business Entity's Registry | Companies Section, Department of Registrar of Companies and Intellectual Property" — page title extracted from fetched HTML; page presents "eSearch" as a lookup tool (search by name/registration number), not a bulk list or export
FOUND: HTTP 200. Page structure is entirely a search-and-lifecycle portal (Starting/Running/Closing a Business Entity, Register of Beneficial Owners) with a name/number search box, no CSV/XLSX/API or "download full registry" affordance found in the fetched content
INFERRED: Matches the €10-per-detailed-search model described in public secondary sources; confirms the registry is accessible only per-entity, not as a bulk dataset, and in any case is not the CFI scheme register
```

**Net for Cyprus:** both the primary negative (Companies of Foreign Interest — no public list, confirmed by the BFU's own "held at the Unit" language) and the two adjacent checks (Registrar of Companies: searchable-only, no bulk list; Invest Cyprus: no company directory published) hold up under direct verification. No AI-crawler bans were encountered on any of the three domains fetched this pass (gov.cy, businessincyprus.gov.cy, investcyprus.org.cy, companies.gov.cy all served content to a browser-UA curl without a Cloudflare/robots block).
