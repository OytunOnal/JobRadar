# ATS fixtures — where each one came from

Two kinds of evidence live in this directory, and they are not equally strong.
Six months from now the difference matters, so it is written down.

**CAPTURED** — a real response from the live API, taken on 2026-08-24 against a
board that exists in the pool, then trimmed to one or two records. If the
platform changes its response shape, this file is what stops the mapper from
silently agreeing with a shape nobody ships any more.

**DERIVED** — written by hand from the fields the fetcher reads. It pins the
mapping against regressions, which is real value, but it is partly circular:
the fixture matches what the code expects, so a live response that differs in
some way the code never looked at will not be caught here. These are the
platforms with no validated board in the pool at capture time — curated-only
tenants (Phenom, Radancy, Avature), auth-bootstrapped ones (CSOD, Comeet,
Jobvite), and the enterprise systems discovery has not reached yet.

Replacing a DERIVED fixture with a CAPTURED one is always an improvement, and
needs nothing but a live board token.

| fixture | provenance | source |
|---|---|---|
| `greenhouse.json` | CAPTURED | `boards-api.greenhouse.io` — board `datakindinc` |
| `lever.json` | CAPTURED | `api.eu.lever.co` — board `blackshark`, EU region (the separate-namespace quirk the connector documents) |
| `ashby.json` | CAPTURED | `api.ashbyhq.com` — board `aida` |
| `smartrecruiters.json` | CAPTURED | `api.smartrecruiters.com` — company `iungospa` |
| `workable.json` | CAPTURED | `apply.workable.com` widget — account `99xbrazil` |
| `recruitee.json` | CAPTURED | `siwaresystems.recruitee.com` |
| `bamboohr.json` | CAPTURED | `anyip.bamboohr.com/careers/list` |
| `breezy.json` | CAPTURED | `mantic.breezy.hr/json` |
| `teamtailor.txt` | CAPTURED | `psv.teamtailor.com/jobs.rss` — one `<item>` |
| `personio.txt` | CAPTURED | `abcfinlab.jobs.personio.com/xml` — one `<position>` |
| `workday.json` | CAPTURED | `xboxgaming.wd1.myworkdayjobs.com` — site `centraltech` |
| `join.txt` | CAPTURED | `join.com/companies/02100` — the `__NEXT_DATA__` block only |
| `oracle.json` | DERIVED | no validated Oracle board in the pool |
| `beesite.json` | DERIVED | curated-only (Mercedes-Benz and similar) |
| `successfactors.json` | DERIVED | curated-only; also locale-gated |
| `eightfold.json` | DERIVED | tenants must enable the public API |
| `jibe.json` | DERIVED | no validated board in the pool |
| `rippling.json` | DERIVED | includes the one-row-per-location duplicate the mapper merges |
| `phenom.json` | DERIVED | every tenant on its own branded host |
| `gem.json` | DERIVED | unknown boards answer 200 with an empty list |
| `comeet.json` | DERIVED | needs a token bootstrapped off the hosted page |
| `getro.json` | DERIVED | needs a network id bootstrapped off the page |
| `pinpoint.json` | DERIVED | no validated board in the pool |
| `avature.txt` | DERIVED | curated-only |
| `radancy.json` | DERIVED | curated-only; includes a duplicate anchor and a non-job link |
| `csod.json` | DERIVED | needs an anonymous JWT bootstrapped off the home page |
| `jobvite.txt` | DERIVED | rate-limits hard; one feed call per run |
| `softgarden.txt` | DERIVED | includes a duplicate anchor and a non-job link |
| `manatal.json` | RECORDED | live GET careers-page.com/api/v1.0/c/elevus/jobs/ 2026-09-02, descriptions trimmed to 300 chars |
| `hrmanager.json` | RECORDED | live GET api.hr-manager.net/jobportal.svc/energinet/positionlist/json/ 2026-09-03, trimmed to 3 of 43 positions |
