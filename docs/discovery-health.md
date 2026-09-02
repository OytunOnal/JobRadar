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
