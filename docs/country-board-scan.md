# Country board scan

Which job boards and national services matter for tech hiring, country by
country, that JobRadar does not already cover — and which have machine-readable
doors. Companion to [ats-market-scan.md](ats-market-scan.md), which asks the
same question platform by platform. Every claim carries the URL that was
actually fetched; marketing pages were not accepted as evidence.

Priority order: Netherlands, Germany, United Kingdom, Ireland, France, Spain.

## 2026-09-02 — France

| Board | Type | Machine door (verified URL) | Visa relevance | Verdict |
|---|---|---|---|---|
| Free-Work | private, IT-only (perm + freelance, FR+UK) | **yes** — sitemap index `https://statics.free-work.com/sitemapindex.xml` (regenerated daily, 19 child maps incl. `sitemap-job-postings-fr--tech.xml`); job pages server-rendered (verified `https://www.free-work.com/fr/tech-it/job-mission/administrateur-de-base-de-donnee-oracle-sybase/administrateur-kubernetes-h-f-2`) | low — mostly FR-domestic, French-language | **adapter-worthy** |
| Next Level Jobs EU | visa-sponsorship-curated EU tech board | **yes** — `robots.txt` allows all + sitemap; `https://nextleveljobs.eu/jobs/sitemap.xml` valid, ~1,100 jobs, lastmod fresh; job pages server-rendered (verified `https://nextleveljobs.eu/companies/wise/jobs/6a8f21cf20542bdc259c1b63`) | **high** — sponsor-curated, covers all six target countries | **adapter-worthy**, with the caveat below |
| France Travail — API Offres d'emploi | national service | **yes but keyed** — free open-access tier, OAuth2 client-credentials, ~1M calls/mo; catalogue `https://francetravail.io/produits-partages/catalogue/offres-emploi`, confirmed via `https://www.data.gouv.fr/dataservices/api-offres-demploi` | low-medium — richer filters (ROME code, commune) than the EURES mirror | park (keyed) |
| French Tech Visa company list | visa-eligible-employer registry | **no verified door** — `https://visa.lafrenchtech.com/` refused twice (socket closed); the gouv.fr page publishes criteria, not a structured list | high if extractable | park — retry from a real browser; an Airtable/Algolia backend would seed sponsor-company discovery |
| HelloWork | generalist #1 FR private board | partial — `robots.txt` disallows `/api/` and search paths; sitemap is whole-site, not tech-scoped | low | skip |
| LesJeudis | IT board (legacy) | **no** — `https://www.lesjeudis.com/robots.txt` blocks ClaudeBot/GPTBot/CCBot with `Disallow: /` | low | skip — explicit AI-crawler ban, respected |
| Apec | semi-public cadre/engineer board | no public door — `robots.txt` refused connection; no API on data.gouv.fr | low | skip |
| ChooseYourBoss | IT reverse-recruitment | unverifiable — host unreachable to the fetcher; login-gated matching model | low | skip |
| Talent.io | matching platform | login-gated matching, no browsable pool (taken over by Davidson Consulting, 2025) | low | skip |

**Caveat on Next Level Jobs EU:** its inventory is big-name sponsors (Wise,
Elastic, Datadog, Criteo, Alan, BlaBlaCar, Doctolib), most already reachable
through the Greenhouse/Lever/Ashby discovery adapters. Its marginal value is
therefore the *sponsor-company signal* rather than the postings — the cheapest
integration may be harvesting its company list to seed ATS discovery, not
ingesting its jobs.

**Checked, not worth it (France):** LesJeudis, HelloWork, Apec,
ChooseYourBoss, Talent.io, Cadremploi (host unreachable, generalist),
eurotoptech.com (blog, not a board).
