# Greece Job Board Scan

**Date scanned:** 2026-09-03  
**Scope:** Tech job boards, public employment services, visa sponsorship capability  
**Total fetches:** 6

## Findable Boards & Registers

| Board/Register | Type | Machine Door | URL Fetched | Visa Relevance | Verdict |
|---|---|---|---|---|---|
| jobfind.gr | Private job board | RSS feed ✓ | https://jobfind.gr/rss/rssjobfind_recentads.ashx | No visa field in feed | Park: Feed exists but no visa data in postings |
| DYPA (Greek Public Employment Service) | Government service | None found | https://dypa.gov.gr | Unknown (no machine access) | Skip: No published machine-readable feed or API |

## Verification Details

**jobfind.gr:**
- **Found:** RSS feed exists at `/rss/rssjobfind_recentads.ashx` (valid RSS 2.0 format, Greek language)
- **Found:** Allows all crawlers (robots.txt: `Allow: /`)
- **Found:** No sitemap reference in robots.txt
- **Inferred:** Server-rendered with client-side filtering; structured navigation suggests queryable job database
- **Found:** Feed contains job title, link, description, region, publication date per posting
- **Found:** NO visa sponsorship, work permit, or relocation information in feed data
- **Blocked:** kariera.gr returned 403 Forbidden (access restricted)
- **Blocked:** skywalker.gr returned 403 Forbidden (access restricted)

**DYPA (dypa.gov.gr):**
- **Found:** Public homepage accessible
- **Found:** Mentions JOBmatch platform and job browsing capability
- **Found:** NO API, RSS, JSON-LD, or bulk download documented
- **Inferred:** Web-only interface, no machine-readable data export capability identified
- **Note:** Direct government ministry URLs (mof.gov.cy) returned DNS/cert errors during attempts to research European public registers

## Market Size & Conclusion

Greece's job board ecosystem is thin for tech roles with visa visibility:
- Only 1 board with machine-readable feed (jobfind.gr), and it carries **no visa sponsorship metadata**
- Public employment service (DYPA) has no published API or data feed
- Two prominent boards (kariera.gr, skywalker.gr) blocked via 403, suggesting auth or bot-detection gating
- No published visa sponsor register or KEI-equivalent scheme found

**Adapter Opportunity:** jobfind.gr's RSS feed is scrapeable, but absence of visa field data means ingest would require:
1. Per-posting page fetch to detect visa language (expensive)
2. Or classify as "visa unknown" (low signal)

**Recommendation:** Skip Greece in current prioritization unless employer site crawl reveals visa sponsorship patterns. Market too thin and metadata too sparse for visa-first ingest.
