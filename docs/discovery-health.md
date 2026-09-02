# Discovery health

Monthly sampled false-negative rate of name-probe misses.
Run: `npm run measure:discovery` (optionally `-- --n 30`).

## 2026-09-01 — n=30 of 215 misses

Probe signature: `ashby,greenhouse,join,personio,recruitee,smartrecruiters,teamtailor,workable`

| category | count |
|---|---|
| probe-now-hits | 1 |
| board-elsewhere | 0 |
| site-no-ats | 24 |
| no-website | 5 |
| llm-unavailable | 0 |

**False-negative rate: 3.3%** (1/30)

- Beglaubigt.de: probe-now-hits (join:beglaubigtde)

## 2026-09-02 — custom career pages: JSON-LD coverage (#17 stage 1)

Of 93 name-probe misses with a resolved website, a careers page was located
for 47 (17 sites unreachable). JSON-LD JobPosting markup: **2/93 (2.2%)** —
enersis.ch and soptim.de. The kill threshold was 10%; the "custom board"
source kind is refuted by measurement. Caveat recorded: the locator found only
half the careers pages (JS-rendered menus hide some), but even doubling the
rate stays far under the bar.

## 2026-09-02 — platform client directories: scouted and closed (#14)

The premise was that ATS platforms list their own customers somewhere
crawlable. Scouted the three candidates:

- **Join**: `/companies` is 404; `/jobs` is a fully client-rendered SPA with
  zero data in its HTML — harvesting would mean reverse-engineering an
  undocumented internal API, which is a different posture than fetching
  public pages (their robots.txt welcomes content fetchers; their API makes
  no such offer). Individual board pages still work for the probe.
- **Ashby**: no sitemap (the sitemap URL returns the app shell), no public
  index of boards.
- **Teamtailor**: marketing sitemap only — 2,616 pages, none of them customer
  career sites; the customers pages are case-study showcases.

No stage 2. Board discovery at scale stays with the crawl-data route (#15),
which finds board URLs in the wild instead of asking platforms for a list.

## 2026-09-02 — dead-board verdicts hold (#7)

Stratified re-probe of the 15,044 dead boards with today's prober (which has
grown the HTML tier and honest-429 handling since most verdicts were
written): 40 random per platform across the top eight platforms, 320 total.
**Revived: 0** (319 still dead, 1 transient error). The "revive a few hundred
for free" hypothesis is refuted; dead verdicts are trustworthy, and the
existing 30-day recheck loop (runValidation, hand-run via
`npm run discovery:validate`) is sufficient coverage for drift.
