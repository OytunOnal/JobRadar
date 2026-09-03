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

## Deep verification pass, 2026-09-04

**Verdict: CONFIRMED — no KEI list is published.** Identity Malta Agency has
been restructured into "Identità"; the old `identitymalta.com` now
301-redirects to `https://identita.gov.mt/` (confirmed via `curl -I`, header
`Location: https://identita.gov.mt/`, read 2026-09-04). The KEI programme
page on the new domain was fetched directly and carries no list, register, or
link to one.

```
SOURCE: https://identita.gov.mt/expatriates-unit-main-page/noneu-nationals/employment-related-permits/highly-qualified-individuals/key-employee-initiative/ · read 2026-09-04 · fetched
QUOTES: "The Key Employment Initiative (KEI) offers a fast track to the single permit procedure to highly skilled third-country nationals." — full page text extracted from fetched HTML; page describes only eligibility/processing (5 working days), no employer list or register
FOUND: HTTP 200 (curl, browser UA). Page nav includes Expatriates Unit, Identity Cards, Passport Office, Public Registry, Central Visa Unit — no "sponsor list" or "approved employers" link anywhere in the fetched HTML. Only outbound content-link found: a "Translators List" (unrelated unit)
INFERRED: KEI approvals are handled per-application (employer submits online, endorsed by applicant) with no published roll of participating employers

SOURCE: https://identitymalta.com/robots.txt · read 2026-09-04 · fetched
FOUND: HTTP 301, `Location: https://identita.gov.mt/` — confirms the domain migration from the entity named in the original negative ("Identity Malta") to "Identità"
```

**Jobsplus — CONFIRMED, no employer licence / work-permit approval list found**, and the negative is now evidenced rather than inferred from an outage. The 2026-09-03 scan recorded jobsplus.gov.mt as unreachable due to an expired certificate; that is no longer the blocker. The site is live but Cloudflare-gated on some paths.

```
SOURCE: https://jobsplus.gov.mt/ · read 2026-09-04 · fetched
FOUND: Homepage reachable, no menu item, page, or mention of a licensed-employment-agencies register or a work-permit-approved-employers list. Nav covers jobseeker services, courses, funding schemes, trade testing
INFERRED: none beyond the negative

SOURCE: https://jobsplus.gov.mt/about-jobsplus-employer · read 2026-09-04 · fetched
FOUND: Employer-facing overview page; no reference to a downloadable list of licensed employers or agencies. Only document link found on the page is a "Course on Maltese Language and Culture for Third-Country Nationals" PDF
INFERRED: none

SOURCE: https://jobsplus.gov.mt/employers · read 2026-09-04 · unreachable
FOUND: HTTP 404

SOURCE: https://jobsplus.gov.mt/sitemap.xml · read 2026-09-04 · unreachable
FOUND: HTTP 403, header `Cf-Mitigated: challenge` (Cloudflare Managed Challenge, JS-required) — retried once with a browser User-Agent via curl per instructions, still blocked. Not a robots.txt AI-crawler ban (no disallow rule matches); it is a bot-interstitial wall on this specific path. robots.txt itself returns the same Cloudflare challenge page rather than a robots ruleset
```

**MGA (Malta Gaming Authority) licensee register — a register EXISTS, but as a searchable-only web app with no bulk export found. This is a gaming-licensee register, not an immigration register**, offered per the task as a seedable company list for Malta's iGaming sector regardless of visa relevance.

```
SOURCE: https://www.mga.org.mt/licensee-hub/licensee-register/ · read 2026-09-04 · fetched
QUOTES: `<iframe src="https://mgalicenseeregister.mga.org.mt" title="MGA Licensee Register" style="width:100%; height:860px">` — the register is embedded as an iframe pointing at a separate subdomain app; the parent page itself carries no data, only nav chrome
FOUND: Page body has no descriptive text, table, or download link — confirmed by extracting all text from the fetched HTML (nav/footer only)

SOURCE: https://mgalicenseeregister.mga.org.mt · read 2026-09-04 · fetched
FOUND: HTTP 200, 71,765-byte HTML shell loading an Angular single-page app (`runtime.f61f7a1c2d212779.js`, `polyfills.b5681f2992db183c.js`, `main.b85c405b5edb9554.js`). The 2.5 MB main bundle was fetched and searched (case-insensitive) for `api`, `export`, `download`, `csv`, `excel`, `xlsx`, `pdf` — zero literal matches; the bundle's string data is hex-obfuscated (e.g. `\x6b\x72\x4e\x4a\x68`), so this is a "no export UI wired at the routing/label level found by static grep" finding, not proof no API exists underneath obfuscation
INFERRED: This is a client-rendered search interface (consistent with the earlier scan's description: "search by licensee name, authorisation status, URL or Gaming Service"), not a downloadable list. Count: not counted — no full listing was retrievable without executing the obfuscated JS and driving the search UI, which was out of scope for a static fetch
```

**MFSA (Malta Financial Services Authority) Financial Services Register — unreachable, blocked by a Cloudflare interactive challenge (not a robots.txt AI-crawler ban).** This would be Malta's fintech/financial-services licensee register per the task's framing; its content could not be verified.

```
SOURCE: https://www.mfsa.mt/financial-services-register/ · read 2026-09-04 · unreachable
FOUND: WebFetch returned HTTP 403. Retried once via curl with a browser User-Agent per instructions: response is a Cloudflare "Just a moment..." managed-challenge page (`meta name="robots" content="noindex,nofollow"`, JS challenge script), not the register itself

SOURCE: https://fsr.mfsa.mt/ · read 2026-09-04 · unreachable
FOUND: curl with browser User-Agent returns HTTP 403, header `Cf-Mitigated: challenge`, same Cloudflare managed-challenge interstitial as above
```

**Net for Malta:** the KEI negative is CONFIRMED with a direct fetch of the current (migrated) agency page — no list, no register link. Jobsplus is likewise CONFIRMED, now evidenced by a live fetch rather than an outage. MGA has a real, government-run licensee register, but it is a searchable web app with no bulk list found (a different answer from "no list" — it is "list exists, not downloadable, not counted"), and it is a gambling-sector register, not a visa register. MFSA's register could not be assessed either way — it sits behind a Cloudflare interactive challenge that blocks unauthenticated fetch tooling entirely.
