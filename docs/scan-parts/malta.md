# Malta Job Board Scan

**Date scanned:** 2026-09-03  
**Scope:** Tech job boards, public employment services, Key Employee Initiative (KEI) register, visa sponsorship capability  
**Total fetches:** 5

## Findable Boards & Registers

| Board/Register | Type | Machine Door | URL Fetched | Visa Relevance | Verdict |
|---|---|---|---|---|---|
| keepmeposted.com.mt | Private job marketplace | Sitemap ✓ | https://keepmeposted.com.mt/sitemap.xml | No visa filter observed | Park: Has structure, no visa field; could ingest but signal weak |
| Key Employee Initiative (KEI) | Government sponsor scheme | None found | (Attempted: nso.gov.mt, identitymalta.com, csbgroup.com) | HIGH – explicit visa sponsorship vehicle | Skip: NOT published as machine-readable register |
| Jobsplus (National Employment Service) | Government service | Unreachable | https://jobsplus.gov.mt | Unknown | Skip: Certificate expired, unreachable |

## Verification Details

**keepmeposted.com.mt:**
- **Found:** Sitemap.xml exists; last modified 2025-09-24; 42 URLs mapped
- **Found:** Site structure shows job listings, employer dashboard, applicant portal, admin panel
- **Found:** Allows crawling with 30-second delay (robots.txt)
- **Found:** WordPress-based platform (wp-admin patterns in robots.txt)
- **Found:** No `/api` endpoint (404 on https://keepmeposted.com.mt/api)
- **Inferred:** Traditional web crawler ingestion possible via sitemap, but no native API or JSON feed
- **Found:** No visa sponsorship or work permit filter visible on main job browse pages
- **Note:** castilleresources.com is NOT a job board; it's an executive recruitment/professional network ("Castille | The Executive Network")

**Key Employee Initiative (KEI):**
- **Inferred:** Malta's visa sponsorship scheme exists and CSB Group references it in professional services context
- **Found:** NOT published as a public, machine-readable registry (no dedicated government portal found despite attempts at nso.gov.mt, identitymalta.com)
- **Found:** Identity Malta gateway (identitymalta.com) returned 403 Forbidden
- **Inferred:** KEI sponsor list likely restricted to government/institutional access or published in closed format (XLSX, PDF with manual updates)
- **High value if found:** This would be the single most relevant source for Malta visa sponsorship

**Jobsplus:**
- **Found:** jobsplus.gov.mt unreachable (certificate expired)
- **Inferred:** Government employment service exists but technical access blocked

## Market Size & Conclusion

Malta's market is small but strategically important (English-language jobs, KEI visa vehicle):
- 1 private board with machine door (keepmeposted.com.mt) but no visa metadata
- No published, machine-readable KEI sponsor register despite high relevance
- Government employment service inaccessible
- iGaming sector job boards mentioned locally but not verified (domain egamingcareers.mt not found)

**Adapter Opportunity:** keepmeposted.com.mt is sitemap-scrapeable but low signal (no visa field). KEI register is **HIGH VALUE if publishable** but currently not machine-accessible.

**Recommendation:** 
1. **Park keepmeposted.com.mt:** Technically scrapeable via sitemap, but visa metadata absent means ingest overhead outweighs signal
2. **Investigate KEI publishing:** Query Identity Malta / MFSS whether KEI sponsor list is published in any format (HTML, XLSX, JSON, open data portal). If it exists in public form, it's the single most valuable discovery in all three countries.
