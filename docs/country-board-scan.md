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

## 2026-09-02 — the other five countries

Each country's full table, with every verified URL, lives in
[`scan-parts/`](scan-parts/): [netherlands](scan-parts/netherlands.md),
[germany](scan-parts/germany.md), [united-kingdom](scan-parts/united-kingdom.md),
[ireland](scan-parts/ireland.md), [spain](scan-parts/spain.md). Headlines only
here.

**Netherlands.** Top find: the **IND public register of recognised sponsors** —
monthly-refreshed, keyless, server-rendered HTML table of every employer
allowed to sponsor a kennismigrant, with a KVK number per row as a join key.
Runner-up: IamExpat Jobs (SSR, JSON-LD detail pages, robots permits).
werk.nl has no vacancy API by UWV's own written answer; Tweakers/Intermediair/
Nationale Vacaturebank all sit behind one Akamai WAF.

**Germany.** Top find: **EnglishJobs.de** — keyless, server-rendered, with a
first-class visa-sponsorship facet over English-only German postings (209 live
at fetch). Caveat: job links are robots-disallowed clickouts, so an adapter
reads the listing HTML and stores the clickout URL without crawling it.
Runners-up: JobGlance (892 sponsored roles claimed, pagination needs
discovery), IT-Treff (cleanest door — schema.org RSS, robots explicitly allows
Claude — but German-language enterprise IT, no visa signal). StepStone, Xing,
Honeypot, Make it in Germany: all walled.

**United Kingdom.** Top find is not a board: the **GOV.UK Register of Licensed
Sponsors** — keyless, daily-refreshed 10.9MB CSV behind a stable Content-API
URL. It is the seed list of every company that CAN sponsor, the complement to
huntukvisasponsors (which rates postings). Bonus: an open per-SOC salary-
threshold CSV (myvisajobs.co.uk) that would feed src/lib/visa/ directly.
Every UK private tech board is a dead end (CWJobs, Totaljobs, Technojobs,
Haystack, Reed's keyed API); gov.uk Find a Job publishes no feed.

**Ireland.** Top find: **VisaJobs.ie** — Ireland-only sponsorship board, open
robots, 8,000 job pages in the sitemap, keyless SSR filtering, every posting
scored against the government permit register; it also re-serves IrishJobs.ie
rows that are otherwise Akamai-walled. And the **DETE permits-issued XLSX**
beats what VisaSponsor holds: 7,095 employers with per-month permit counts
(ours: 6,351 bare names). JobsIreland (DSP) is legally load-bearing for
General Employment Permits but Critical Skills roles are exempt, so senior
tech is under-represented there.

**Spain.** Top find: **SpainJobs.io** — robots declares `ai-input=yes`, 40k
job URLs in a daily sitemap, JSON-LD details, and a curated visa surface (16
sponsor companies, 123 roles). Runner-up: JobsinBarcelona.es (10k jobs,
English-working-language audience). Tecnoempleo and JobFluent — the two best
content fits — both name ClaudeBot in a `Disallow: /`, respected. No official
register exists to ingest: UGE-CE publishes no list, ENISA's is locked in a
Power BI iframe.

## Top recommendations across all six

Ranked by visa-relevance × feasibility:

1. **Sponsor registers as first-class sources** (UK CSV daily + IE XLSX with
   permit counts + NL IND table with KVK numbers): richer than the bare-name
   lists VisaSponsor holds today, and each feeds both the visa evidence layer
   and the #13/#21 seeding lanes. One issue, three importers.
2. **VisaJobs.ie adapter**: sponsorship-scored postings, open door, and a way
   around IrishJobs' Akamai wall.
3. **EnglishJobs.de adapter**: the German visa-facet board; listing-page-only
   crawl per its robots.
4. **SpainJobs.io adapter**: explicitly AI-open, JSON-LD, plus its curated
   sponsor-company list as seed.
5. **Next Level Jobs EU** (from the France section): EU-wide sponsor-curated
   sitemap; harvest its company list as seed rather than ingesting jobs.

Parked with recorded leads: IamExpat (NL), JobGlance + IT-Treff (DE),
JobsInBarcelona (ES), JobsIreland (IE), visasponsor.jobs API (18 IE rows
today), France Travail API (keyed), Free-Work (FR, low visa relevance),
UK per-SOC salary CSV (for src/lib/visa/, not a source).

## 2026-09-03 — the Nordics (#28)

Full tables in [`scan-parts/`](scan-parts/): [sweden](scan-parts/sweden.md),
[norway](scan-parts/norway.md), [finland](scan-parts/finland.md),
[denmark](scan-parts/denmark.md), [iceland](scan-parts/iceland.md).

**Norway.** Top find of the whole group: **NAV's pam-stilling-feed** —
self-serve public token, JSON-Feed linked list (backfill once, resume
incrementally), full bodies, robots fully open. The national ad pool behind
a clean API. finn.no, the dominant private board, is fully client-rendered
with zero extractable links — closed.

**Sweden.** **JobTech JobStream** verified: a change-delta stream over the
same national data our query-window source reads — an upgrade that closes
the ads-no-query-matches gap and adds deltas for delisting. Best new board:
**Demando** (tech-only, sitemap + JobPosting JSON-LD verified). Register
re-verified negative: "certifierad arbetsgivare" has no published list.
TheLocal.se and Jobbland ban ClaudeBot/anthropic-ai by name — respected.

**Denmark.** **IT-Jobbank** — tech-only board on the same Jobindex stack we
already ingest: RSS per query, JSON-LD detail pages, googleforjobs sitemap;
a near-clone of the jobindexdk adapter. Nothing adds to the SIRI register we
hold; Workindenmark IS jobnet+EURES, both already ingested. New HR-Manager
fact: no central alias directory, but alias probing is free (200+CustomerName
vs 400) — a name-probe platform candidate. Ofir and techjob.dk ban crawlers
(the latter names ClaudeBot) — respected.

**Finland.** Honestly thin: Oikotie shut down, Monster.fi is Cloudflare-
walled, Työmarkkinatori's API needs applied-for credentials (the honest
path if Finland matters). Register status contested between agents and
UNVERIFIABLE by us — migri.fi/en/certified-employers answers 403 to every
fetcher we have; the working verdict stays "no usable register", revisit
from a real browser. Flag resolved: duunitori's robots.txt 403s but the API
our adapter uses still answers (502 jobs live) — the source is healthy.

**Iceland.** Genuinely thin. **Alfreð** (alfred.is) embeds ~27 jobs + a
totalCount in __NEXT_DATA__ on one keyless page; robots bans /api/ and
pagination is client-side, so a page-1 poller is the ceiling.

## 2026-09-03 — Southern Europe (#30)

Full tables in [`scan-parts/`](scan-parts/): [italy](scan-parts/italy.md),
[portugal](scan-parts/portugal.md), [greece](scan-parts/greece.md),
[malta](scan-parts/malta.md), [cyprus](scan-parts/cyprus.md). Each file ends
with a verification pass: every positive claim was re-fetched before being
recorded, and two verdicts flipped as a result.

**Portugal.** Find of the issue: **IAPMEI's Tech Visa certified-company
register**, parsed rather than estimated — 556 companies, 373 certified
today, each row carrying a NIF (join key) and a validity window. No other
register we hold says *until when* a certification lasts. Needs a browser
User-Agent to download. ITJobs.pt parked: its declared feed host does not
resolve, but a sitemap index does answer.

**Italy.** No adapter-worthy door — an evidenced closure, not an unexplored
gap. Trovolavoro's robots is `Allow: /$` + `Disallow: /` (homepage only, no
sitemap); ClicLavoro is up and bans AI crawlers; anpal.gov.it is a dead host;
dati.gov.it's vacancy-shaped datasets are statistical, and the one live
regional CSV is unreachable from two fetchers. No sponsorship register
exists: decreto flussi nulla osta are per-permit acts, never a list.

**Cyprus.** **Ergodotisi** — 5,166 job URLs in a permitted sitemap,
server-rendered, no JSON-LD but a strict `Role at Company | Ergodotisi` title
plus og:description, so a bespoke parse in the huntukvisa shape. Generalist
rather than tech, but structurally valuable: an EU market whose working
language is English. cyprusjobs.com names ClaudeBot — respected.

**Greece and Malta.** Thin. jobfind.gr offers an RSS feed with no visa
signal; kariera.gr and skywalker.gr answer 403. keepmeposted.com.mt is
sitemap-crawlable but small; jobsplus.gov.mt has an expired certificate.
Both register questions closed negative: **Malta's Key Employee Initiative
and Cyprus's Companies of Foreign Interest publish no list**, which retires
two of this issue's three highest-value hypotheses.

## 2026-09-04 — DACH + Benelux remainder (#29)

Full tables in [`scan-parts/`](scan-parts/): [austria](scan-parts/austria.md),
[switzerland](scan-parts/switzerland.md), [belgium](scan-parts/belgium.md),
[luxembourg](scan-parts/luxembourg.md).

**Austria.** **karriere.at** — 12,749 postings in the sitemap its robots.txt
declares, full JobPosting JSON-LD per detail page. Adapter shipped. The find
also produced this project's most-repeated method note: the same board answers
404 at the guessed sitemap path and 200 with all 12,749 at the declared one.

**Switzerland.** **jobs.ch** (42,695 EN detail URLs) and **jobup.ch** (35,647)
ship as one module — same operator, same layout, one path segment apart.
Both declare their sitemaps and disallow `/api/`, so the adapter reads what
they offer. No employer-level permit data exists anywhere; SEM publishes
aggregates only.

**Belgium.** Nothing shipped, and both reasons are worth knowing. **Le Forem**
publishes 25,917 postings through an open-data API, but leforem.be names
ClaudeBot with `Disallow:/` while allowing LinkedInBot — a deliberate choice —
and the API's own host disallows `/api/`. **Actiris** is genuinely open
(robots.txt is nothing but Sitemap lines; 9,643 same-day offer URLs) but
publishes no employer name, because applications route through the agency.
VDAB stays our only Belgian source, covering Flanders alone.

**Luxembourg.** Nothing adapter-worthy. Silicon Luxembourg's keyless WordPress
API serves 392 counted tech postings with full bodies and an allow-all robots,
but carries no employer name either. ADEM publishes no live feed, Moovijob and
jobs.lu are bot-walled, and no permit-sponsor register exists.

**The pattern this group taught.** Two of the largest doors found — Job-Room's
74,094 postings and Le Forem's 25,917 — are deliberately unused because their
operators said not to, and two more are parked because they omit the employer
name. Reach is not the constraint here; permission and provenance are.

## 2026-09-04 — Central/Eastern EU + Baltics (#31)

Ten countries, three deep passes. Files in [`scan-parts/`](scan-parts/):
czechia, slovakia, hungary, romania, bulgaria, croatia, slovenia, estonia,
latvia, lithuania. Each carries a main-session audit; three headline claims
changed on re-fetching.

**Czechia — the find of the group, and now our sixth register.** MPSV's
national vacancy feed is open data with an allow-all robots: 38,195 postings,
38,170 with employer name and IČO, and three employer-declared booleans
including EU Blue Card and employee-card eligibility. Shipped as a REGISTER
rather than a source, because only 1,377 rows carry a public URL: 9,203
employers now in VisaSponsor. Unlike the five licence lists before it, this
one names who is actually hiring from outside the EU rather than who may.

**Hungary.** A real register exists — kormany.hu's list of preferential
employers and qualified labour-hire agencies, 35 entries / 29 active, naming
manufacturers NoFluffJobs never reaches. Caveat recorded: Decree 92/2026 froze
new guest-worker permits on this route in June 2026, so it is a sponsor and
dedupe signal rather than a live channel.

**Latvia — a real register we deliberately did not ingest.** LIAA's Startup
Law XLSX holds 353 companies, but its support-programme column splits them:
212 on tax relief, 63 on the highly-qualified-employee subsidy. A wage subsidy
is not a statement about sponsorship, and `sponsor?` means registered sponsor.
Kept as a discovery seed list instead.

**Romania — the group's biggest unclaimed prize.** The scan's headline, an
open ANOFM JSON feed of 7,628 postings, did not reproduce: four fetch methods
all returned an 11KB HTML SPA shell. Recorded unverified. Its new
workinromania.gov.ro permit registers list 7 companies today with two employer
registers still empty — a monthly re-check, not an importer.

**Slovakia, Bulgaria, Croatia, Slovenia, Estonia, Lithuania.** No employer
register anywhere. Board leads worth a batch: StartupJobs.cz (412, JSON-LD),
dev.bg (1,485, tech-only), CV Keskus (244 IT, JSON-LD), Optius (1,230,
JSON-LD), Posao.hr (IT RSS with employer names). Estonia's Startup Visa
publishes only a 17-company fast-track exemption list, not an approvals
register. Profesia.sk, jobs.bg, MojeDelo and CVbankas are WAF-walled;
unicorns.lt, CV.ee, CV.lv and CVonline.lt name ClaudeBot and were skipped
untouched.
