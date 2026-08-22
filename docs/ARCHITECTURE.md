# JobRadar Architecture

This document explains the data model and the measured decisions behind the
ranking stack. The theme throughout: **facts, derivations, and user intent are
separate layers — facts are immutable, derivations are versioned and
recomputable, user data is small and sacred.**

## The layered data model

Naming convention (it carries the semantics): `...History` = append-only,
never overwritten · `...Log` = event stream · `...Snapshot` = computed
summary, reproducible at will.

```
FACTS                CANONICAL              DERIVED (versioned)        USER
─────                ─────────              ───────────────────        ────
JobListingHistory ─▶ Job (thin hot core) ◀─ KeywordScoreHistory        UserActionLog
                      ├─ JobContent      ◀─ LlmJudgmentHistory             │
                      └─ JobEmbedding                                      ▼
                                                              Job.status = projection
```

| Table | Holds | Why it exists |
|---|---|---|
| `Job` | identity, title, company, current score/fit/status projections (~300 B/row) | Every radar query runs here. The current values of score/fit/status are **cached projections** of the history tables (CQRS-lite): SQLite sorting wants the current value on the hot row. |
| `JobContent` | description (≤8 KB), content hash, cover letter | Only three consumers ever read the text (card detail, desc-fill, LLM prompts) — all row-at-a-time. List scans never touch these pages. |
| `JobEmbedding` | model tag + Float32 vector (4 KB) | Split even from content: the queue builder reads *all* vectors sequentially; a dense small table beats picking blobs out of text pages. The model tag prevents silently mixing vector spaces. |
| `JobListingHistory` | listed / delisted / relisted events | Freshness used to be overwritten in place, destroying the repost trail — which is exactly the ghost-posting signal. Events are written on state changes only, not every sweep. |
| `KeywordScoreHistory` | every scorer verdict + `scorerVersion` | A re-score is now "fill where version < current", and "what did v4 wrongly kill" is a query. |
| `LlmJudgmentHistory` | every LLM verdict + model + `promptVersion` | When the 27B overwrote the 8B's score in place, the calibration data (see ADR-3) was lost forever. Judgments are appended, never replaced; the hot row projects the authoritative one. |
| `UserActionLog` | applied / dismissed(reason) / starred / note events | Dismissal reasons turned out to be the system's most valuable labeled data (ADR-5); overwriting `status` had been discarding history. |
| `DashboardStatsSnapshot` | ingest-end counters | The stat strip reads one row instead of group-by'ing half a million on every filter click. |

**Measured effect of the split:** the pre-split Job row averaged ~10 KB
(8 KB description + 4 KB embedding inline). Every filter click paged through
gigabytes. After the split, the main list query (filter + composite-index sort
over 525k rows) measures **4 ms**.

**Deliberate compromise:** a purist design would derive current score/status
by joining the history tables. The hot-row projections trade purity for
SQLite sort performance — documented here precisely because it's a tradeoff.

## Decision records

### ADR-1 · Store everything; flag judgment (store-all)

**Before:** postings failing the keyword gates were dropped at ingest. Every
scorer improvement raised the same unanswerable question: *what did the old
scorer wrongly kill?* Answering meant re-crawling ~50k boards.

**After:** every fetched posting is stored; gate-rejected ones carry
`disqualified=true` and never render. A scorer fix is a local re-score.
The flag + a partial-index-style composite keeps the archive out of the hot
query path.

**Evidence this was needed:** three manual audit rounds had found the scorer
killing German/Dutch/Polish titles (English-only role signals), real postings
(description-scoped negatives hitting recruiter boilerplate), and
"Salesforce developer" (substring "sales"). Each fix left us blind to what
else had been lost. The first store-all sweep kept 341k postings the old
pipeline would have silently discarded.

### ADR-2 · Embedding bake-off with pre-frozen queries

To decide whether semantic similarity should drive the LLM queue, 5 local
embedding models × 4 query strategies × 2 document variants were evaluated
against existing LLM fit scores (zero new LLM cost). **Query texts were
committed to git before any results existed** — tuning queries against the
test set would invalidate it, and the commit history proves the discipline.

Findings (3,077 fit-scored jobs; metric: precision@100 on a held-out split):

| Ranker | confirm p@100 |
|---|---|
| keyword score (baseline) | 0.580 |
| best embedding (qwen3-embedding:0.6b, whole-CV query) | **0.740** |
| best hypothesized strategy (hand-written facet sentences) | worst in every model |

Surprises: the smallest new-generation model won; the "obvious" facet-sentence
strategy lost to simply embedding the whole CV; the multilingual advantage
couldn't be measured (the survivor pool was English-heavy — noted as a limit,
not assumed).

### ADR-3 · Blend ranks, not scores — weight chosen by sweep

Keyword score and embedding similarity live on incompatible scales, so the
queue blends their **ranks**. A weight sweep (0→100% in 10% steps, evaluated
on tune/confirm/gold slices) showed a plateau at 30–40% keyword:

| kw% | tune p@100 | confirm | gold (27B-judged) |
|---|---|---|---|
| 0 | 0.660 | 0.730 | 0.440 |
| **40** | 0.750 | **0.730** | **0.520** |
| 100 | 0.520 | 0.580 | 0.480 |

The two signals fail differently — keyword is blind to unlisted skills
(a "C# Developer" posting scored like any generic developer), embedding
over-trusts topical similarity — and the blend beats both. Weight lives in
config, re-measured as the gold set grows. Visa-positive postings (sponsor
register / explicit sponsorship) form a strict priority tier above the blend.

### ADR-4 · One strong local judge over a cheap-triage cascade

The first design used a free-cloud/8B triage pass with a 27B review behind it.
Measured on 371 double-judged postings: the first pass ran **~29% optimistic**
— "strong" had stopped meaning anything. Decision: retire the triage tier;
the locally-run 27B judges directly (~1 job/min, fine for a weekly cadence),
stamped with model + prompt version in `LlmJudgmentHistory`. The measurement
that justified this is reproducible forever because judgments are now
append-only (ADR-3's history table) — the original one was a lucky accident
of both values briefly coexisting.

### ADR-5 · Dismissal reasons as labeled training data

Dismissing a job asks *why* (one click: language / seniority / stack /
company-applied / …). 55 reasoned dismissals surfaced four measurable gaps:
a hardcoded senior/staff title boost promoting exactly the levels the user
rejects; language walls buried mid-description sailing to fit 85; native
mobile roles passing the engineering gate; and one application at a company
costing 14 manual dismissals of its sibling postings. Each fix landed in the
layer where it stays true for other users (see below); the reasons now
accumulate in `UserActionLog` by design.

### ADR-6 · Persona-independence: detection is universal, judgment is profile

Every fix from ADR-5 obeyed one rule: **shared code may detect facts;
only the profile may judge them.** Language requirements are detected
universally (multilingual patterns, hedge-aware); whether German-required is
a *barrier* depends on `profile.languages`. Seniority levels are extracted
universally (title levels, years-of-experience, management signals); which
levels are *unwanted* is per-profile and per-track — ten years in Unity makes
"lead" welcome there while newer fields cap at senior. An iOS developer
running this codebase gets their own profile, not this user's exclusions:
user-specific role negatives ride the profile and still respect the
specific-track override (a "Unity iOS Developer" survives an "ios developer"
exclusion).

## Evolution note

The system did not start with this architecture, deliberately: a single fat
table shipped the first 480k postings and produced the findings above. The
layered model was adopted the day the measurements demanded it (filter
latency, lost calibration data, unanswerable audit questions), migrated by an
idempotent SQL script in 31 seconds with the old projections seeded as
`pre-migration` history rows. Starting with event-sourcing on day one would
have been architecture cosplay; adopting it against evidence is the point.
