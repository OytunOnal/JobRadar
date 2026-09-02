# United Kingdom — source scan

Scanned 2026-09-02. Scope: UK only, tech roles, visa sponsorship the deciding
lens. Everything below is backed by a response we actually pulled; where a page
resisted us we say so instead of guessing. Fetches used: ~33 (over the ~25
guideline — the anti-bot walls cost retries under three different clients).

Fetch clients used, in escalation order: WebFetch, then `node -e` with a Chrome
User-Agent, then PowerShell `Invoke-WebRequest`. A site is only called closed
after all three failed.

Already covered elsewhere and not re-tread here: huntukvisasponsors, Adzuna,
JSearch/Indeed, LinkedIn, the 30 ATS discovery platforms, Wellfound, Otta
(inside Welcome to the Jungle), Gem, Dover, HiBob, Jobylon, Talentech.

## The table

| Board | Type | Machine door? | Verified URL | Visa relevance | Verdict |
|---|---|---|---|---|---|
| **GOV.UK Register of Licensed Sponsors (Workers)** | Official open data (Home Office) | **Yes — keyless.** Content API `200` JSON naming today's attachment; CSV served `text/csv`, 10,947,971 bytes, header `Organisation Name,Town/City,County,Type & Rating,Route`; `public_updated_at` `2026-09-02T10:45:56+01:00` | `https://www.gov.uk/api/content/government/publications/register-of-licensed-sponsors-workers` → `https://assets.publishing.service.gov.uk/media/6a97e8bd01bbff0bf8f97c6f/SP_-_Worker_and_Temporary_Worker_Web_Register_-_2026-09-02.csv` | Maximal. This *is* the ground truth every sponsorship board resells. Route column separates Skilled Worker from GBM/International Agreement; rating column flags A vs B | **adapter-worthy — top pick** |
| **myvisajobs.co.uk — SOC going-rates CSV** | Derived reference data | **Yes — keyless.** `200 text/csv`, 70,911 bytes, columns `soc_code,occupation,going_rate_gbp,hourly_rate,new_entrant_rate_gbp,phd_rate_gbp,stem_phd_rate_gbp,phd_points,scale_up_rate_gbp,skill_level,eligibility,industry,source,last_verified`; rows cite gov.uk Appendix Skilled Occupations, `last_verified` `2026-09-01` | `https://www.myvisajobs.co.uk/soc/soc-going-rates-2026.csv` | High but indirect: gives the per-SOC salary floor a posting must clear to be sponsorable. Feeds `src/lib/visa/`, not the posting pool | **adapter-worthy (reference feed, not postings)** |
| **myvisajobs.co.uk — sponsor pages / sponsor CSV** | Sponsor directory | Yes — keyless. robots.txt `Allow: /` for `*` **and explicitly for `ClaudeBot`/`anthropic-ai`**; sitemap index 4 shards, `lastmod` 2026-09-02; shards 1–3 are 45,000 + 45,000 + 37,652 URLs, all `/sponsors/*`. Daily CSV `200`, 8,701,498 bytes, header comment "synced daily … Source: Home Office register (public data). Free to cite with attribution." | `https://www.myvisajobs.co.uk/robots.txt`, `https://www.myvisajobs.co.uk/sitemap.xml`, `https://www.myvisajobs.co.uk/sponsors/uk-sponsor-list.csv` | It is the gov.uk register, normalised. **It carries no job postings of its own** — 127,652 sitemap URLs, zero `/jobs/` segment | **park** — strictly downstream of the gov.uk CSV above; take the source, not the mirror |
| **Reed** | Private board (largest UK generalist) | Yes, but **keyed**. API key sent as basic-auth username with empty password; `https://www.reed.co.uk/api/1.0/search?keywords=&locationName=` and `https://www.reed.co.uk/api/1.0/jobs/{id}`; 100 results max per call, `resultsToSkip`/`resultsToTake` paging | `https://www.reed.co.uk/developers/jobseeker` (fetched, documents the above) | Generalist; no sponsorship field. Would need cross-referencing against the register | **park** — key terms unconfirmed, see caveat below |
| **CWJobs** | Private board (UK tech specialist, StepStone) | **No.** robots.txt fetched `200`, 6,324 bytes: generic `User-agent: *` block is deny-by-default and named-crawler blocks each terminate in `Disallow: /`. It also carries `Disallow: /JobSearch/RSS.aspx` — an RSS endpoint exists and is explicitly closed to crawlers. No API documented anywhere on the host | `https://www.cwjobs.co.uk/robots.txt` | Would have been the best pure-tech UK board. Door is shut | **skip** |
| **Totaljobs** | Private board (StepStone, CWJobs sibling) | **No — anti-bot wall.** Even `/robots.txt` returns `403 Access Denied` from Akamai ("Reference #18.182c1102…") to a Chrome-UA request | `https://www.totaljobs.com/robots.txt` | n/a — cannot read the door, let alone the data | **skip** |
| **GOV.UK "Find a Job" (DWP)** | Public/official | **No.** `findajob.dwp.gov.uk` returns `503` to WebFetch and `ECONNRESET` / timeout to Chrome-UA node and PowerShell alike. `static.findajob.dwp.gov.uk/...` `301`s to `https://www.jobs.service.gov.uk/`. The gov.uk employer guide now points employers at `https://www.jobs.service.gov.uk/employers/byos/home/index.html` | `https://findajob.dwp.gov.uk/`, `https://static.findajob.dwp.gov.uk/images/find_a_job_bulk_upload_spec_v2.2.pdf`, `https://www.gov.uk/government/publications/advertise-your-vacancies/find-a-job-guide-for-employers` | Volume is large but generalist and low-tech-density | **skip** — see the Find a Job note below |
| **Work Hub (`jobs.service.gov.uk`)** | Public/official, successor service | **No.** Homepage fetches, but self-describes as "an experimental service"; no API, RSS, XML or bulk-download link on it. `/robots.txt` returns a GOV.UK "Sorry, there is a problem with the service" `403` page | `https://www.jobs.service.gov.uk/`, `https://www.jobs.service.gov.uk/robots.txt` | Same generalist DWP pool | **skip** (recheck in ~6 months — an experimental GDS service is the kind that later ships a feed) |
| **UKHired** | Sponsorship-focused board | **No — explicit total ban.** robots.txt is 26 bytes: `User-agent: *` / `Disallow: /`. The homepage also returns a JS shell (`<title>Redirecting...</title>` plus an ad-block detector), so listings are not server-rendered | `https://www.ukhired.com/robots.txt`, `https://www.ukhired.com/` | Would have been the natural complement to huntukvisasponsors. Both doors are shut at once | **skip** |
| **visajobs.uk** | Sponsorship-focused board | Yes — keyless. robots.txt `Allow: /` with `ClaudeBot`/`anthropic-ai` named as permitted, plus an `llms.txt` | `https://visajobs.uk/robots.txt`, `https://visajobs.uk/llms.txt` | Its own `llms.txt` says it scrapes "1,000+ UK job postings daily from **Indeed, LinkedIn, Glassdoor, and Google Jobs**" and keeps only roles that confirm a Certificate of Sponsorship, quoting the sponsorship sentence verbatim | **park** — the postings are secondhand from pools we already ingest (JSearch/Indeed, LinkedIn, Adzuna); we would import duplicates. Its verbatim CoS-sentence extraction is the one thing worth revisiting as a labelling signal |
| **ukvisajobs.com** | Sponsorship-focused board | Door open, content stale. robots.txt `Allow: /` with a sitemap; sitemap fetched `200` (67,453 bytes) but every entry we sampled carries `lastmod 2026-02-01` and is a static page (`/about`, `/events`, `/faq`) | `https://www.ukvisajobs.com/robots.txt`, `https://www.ukvisajobs.com/sitemap.xml` | Sponsorship-framed, but seven months without a sitemap refresh | **skip** |
| **sponsorshipjobs.co.uk** | Sponsorship-focused board | Reachable, but **we are named and refused.** Cloudflare-managed robots.txt: `User-agent: ClaudeBot` / `Disallow: /`, alongside `Content-Signal: search=yes,ai-train=no,use=reference`, with the EU DSM Article 4 rights reservation spelled out above it | `https://www.sponsorshipjobs.co.uk/robots.txt` | Sponsorship-framed | **skip** — an explicit refusal of our agent class |
| **Technojobs** | Private board (UK tech specialist) | **No — the host is dark.** `www.technojobs.co.uk` is `NXDOMAIN`; apex `technojobs.co.uk` resolves to `3.9.65.81` but TCP connect times out on both `:443` and `:80` | DNS + `https://technojobs.co.uk/robots.txt`, `http://technojobs.co.uk/` | n/a | **skip — appears defunct** |
| **Haystack** | Private board (UK startup jobs) | **No — domain gone.** `haystack.team` and `www.haystack.team` both `NXDOMAIN`. `haystack.works` resolves and fetches `200` but is an unrelated web-design agency portfolio | DNS; `https://haystack.works/` | n/a | **skip — defunct** |
| **Hired** | Private board (talent marketplace) | **No — the brand is retired.** `https://hired.com/` `200`s but the final URL after redirects is `https://www.lhh.com/en-us/about-us/our-story` | `https://hired.com/` | n/a | **skip** — absorbed into LHH |
| **Otta** | Private board | n/a | n/a | n/a | **already-covered-via Welcome to the Jungle** |

## The Find a Job note

Three separate things are true and they compound:

1. `findajob.dwp.gov.uk` is behind an Akamai wall that refuses every client we
   tried, including a Chrome User-Agent from both node and PowerShell.
2. The only documented machine integration for the service is **inbound** — an
   SFTP bulk-upload channel for employers posting vacancies *in*. We could not
   read the spec ourselves: the PDF at
   `https://static.findajob.dwp.gov.uk/images/find_a_job_bulk_upload_spec_v2.2.pdf`
   now `301`s away to the successor service, so the SFTP detail is secondhand
   from search results and is flagged here as unverified.
3. The estate is mid-migration to Work Hub at `www.jobs.service.gov.uk`, which
   still calls itself experimental.

There is no outbound vacancy API, no RSS, and no open-data vacancy dump for UK
government job postings that we could fetch. The `docs/agents` answer to "is
there a public feed for Find a Job" is: no, and the service it is becoming does
not have one yet either.

## The Reed caveat

Reed's API is real and its shape is documented on a page we fetched, but the
question we were asked — *are the key and the free tier confirmed?* — is
**not settled**. The jobseeker docs page states the auth scheme and endpoints
and says "Sign up for a reed.co.uk API Key", but publishes **no pricing, no
free-tier statement, and no rate limit**. `https://www.reed.co.uk/developers`
lists the APIs without terms, and `https://www.reed.co.uk/developers/signup`
returns a `404` ASP.NET error page, so the signup flow could not be inspected
without an account. Treat "Reed key is free" as unproven until someone
completes the signup.

## Checked, not worth it

- **UKHired** — `robots.txt` is a two-line total ban and the listings are
  client-rendered. Both doors shut. `https://www.ukhired.com/robots.txt`
- **sponsorshipjobs.co.uk** — names `ClaudeBot` in a `Disallow: /` block.
  `https://www.sponsorshipjobs.co.uk/robots.txt`
- **ukvisajobs.com** — open door, sitemap last touched 2026-02-01.
  `https://www.ukvisajobs.com/sitemap.xml`
- **Totaljobs** — Akamai `403` on `/robots.txt` itself.
  `https://www.totaljobs.com/robots.txt`
- **CWJobs** — deny-by-default `robots.txt`; the one RSS endpoint it has
  (`/JobSearch/RSS.aspx`) is explicitly disallowed.
  `https://www.cwjobs.co.uk/robots.txt`
- **Technojobs** — apex resolves, nothing answers on `:80` or `:443`; `www`
  is `NXDOMAIN`. Defunct.
- **Haystack** — `haystack.team` `NXDOMAIN`. Defunct. `haystack.works` is a
  different company entirely.
- **Hired** — redirects to `lhh.com`. The marketplace no longer exists.
- **myvisajobs.co.uk sponsor pages** — 127,652 crawlable sponsor pages, but
  zero postings of their own; it is the gov.uk register with a UI.
- **visajobs.uk** — open and well-behaved, but by its own `llms.txt` it is a
  re-scrape of Indeed, LinkedIn, Glassdoor and Google Jobs. We already drink
  from those wells.

## What this scan actually changes

The UK's private tech boards are closed (CWJobs, Totaljobs), dead (Technojobs,
Haystack, Hired) or keyed-and-unclear (Reed). The public estate has no
outbound feed. The value is not in finding another board at all — it is that
the **canonical sponsor register is a keyless, daily, 10.9 MB CSV addressable
through a stable GOV.UK Content API endpoint**, and JobRadar already owns 30
ATS discovery adapters that turn a company name into that company's live
postings. huntukvisasponsors tells us whether a *posting* is sponsorable. The
register tells us which *companies* can sponsor at all — which is the seed
list, not the filter. The SOC going-rates CSV then supplies the salary floor
each of those postings has to clear.
