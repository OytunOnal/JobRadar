# JobRadar

A local-first job-discovery engine and application tracker. It finds companies'
own hiring boards, keeps every posting it has ever seen, scores each one against
the user's CV, and ranks what survives on a single reading surface.

This file is the glossary. Architectural decisions live in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## The pool

**Posting**:
One advertised role, as one source published it. The same opportunity seen from
two sources is two postings until dedupe says otherwise.
_Avoid_: job, listing, ad, vacancy, opportunity

**Pool**:
Every posting ever fetched, including the ones judgment rejected. Nothing is
removed from it; postings only gain flags.
_Avoid_: index, corpus, database, archive

**Disqualified**:
A posting the keyword gates rejected. It stays in the pool and never reaches
the radar, so a scoring fix is a re-score rather than a re-crawl.
_Avoid_: rejected, filtered out, dropped, deleted

**Duplicate**:
A posting confirmed to be the same opportunity as another — a repost, a
rewording, or one city of a multi-city ad. It stays so the source's own id is
still recognised, and never renders.
_Avoid_: copy, repost, clone

**Delisted**:
The source has stopped listing the posting. Distinct from stale, which is about
our own derived values, and from evergreen, which is about the posting's age.
_Avoid_: closed, expired, dead, removed

**Live posting**:
A posting that is not disqualified, not a duplicate and not delisted. The
single population every reader of the pool is asking about.
_Avoid_: candidate, eligible, active, valid, open

**Open posting**:
A live posting the pipeline still considers: the user has neither dismissed it
nor started pursuing it. What every work queue is about.
_Avoid_: pending, unprocessed, queued

**Discoverable posting**:
An open posting the user has not reacted to at all. The radar's population, and
the only one the radar ranks.
_Avoid_: unseen, fresh, new job

**Pursued posting**:
One the user has applied to and is tracking. It leaves the radar on the way in,
because the radar is for finding work, not for following it.
_Avoid_: in progress, active application

**Dismissed posting**:
One the user said no to, with a reason. It stays in the pool as labelled
feedback and leaves every work queue.
_Avoid_: ignored, hidden, rejected (rejected is what an employer does)

**Archive**:
The disqualified part of the pool. Worked only when nothing else needs the GPU.
_Avoid_: rejects, trash, cold storage

**Radar**:
The ranked reading surface for discoverable postings. Its defining rule is that
it labels a posting's risks rather than hiding the posting.
_Avoid_: dashboard, feed, board, results

## Where postings come from

**Source**:
Anything that yields postings under one name. A source is either a board or an
aggregator.
_Avoid_: provider, feed, site

**Board**:
One company's own hiring page, hosted on a platform. The most trusted kind of
source, because the employer publishes it themselves.
_Avoid_: careers page, company site

**Platform**:
An applicant tracking system whose boards all share one shape, so one adapter
reaches every company using it.
_Avoid_: vendor, provider, system

**Aggregator**:
A source that republishes other people's postings. Cheap to read and the usual
home of reposts and SEO noise.
_Avoid_: job board, portal

**Source trust**:
How directly a source speaks for the employer. Breaks ties when the same
opportunity arrives from several sources.
_Avoid_: quality, reliability, weight

**Discovery**:
Finding boards that exist. Separate from ingest, which fetches postings from
boards already known.
_Avoid_: crawling, scraping, harvesting

**Ingest**:
One pass that fetches from sources and stores what it finds.
_Avoid_: crawl, scrape, sync, import, refresh

**Sweep**:
An ingest across the whole discovered board pool rather than the curated set.
Long, resumable, and run deliberately.
_Avoid_: full run, batch

## The text of a posting

**Description**:
A posting's body, as readable text. Markup is not description; it is a defect.
_Avoid_: content, body, HTML

**Kept text**:
When two sightings of one posting carry different bodies, the fuller one is
kept and every derived value follows it. A title-only re-sighting never
replaces a full description.
_Avoid_: best text, canonical text, latest text

**Section**:
A labelled part of a description — requirements, responsibilities, benefits,
boilerplate. What a posting's own headings reveal about its structure.
_Avoid_: block, chunk, part, paragraph

**View**:
The portion of a description one consumer receives, assembled from sections
within that consumer's budget. Never a blind prefix of the text.
_Avoid_: excerpt, snippet, slice, truncation

**Consumer**:
Something that reads a view rather than the whole description: the judge, the
embedding, the facts pass.
_Avoid_: client, caller

## Judgment

**Score**:
The deterministic keyword score. Cheap, computed for every posting, and the
only ranking signal that exists before any model runs.
_Avoid_: rating, relevance, match

**Fit**:
The judge's verdict on one posting against the CV: a fit score, a verdict word,
and its reasoning. Always qualified — an unqualified "score" means the keyword
score.
_Avoid_: LLM score, AI score, match score

**Judge**:
The model that produces a fit. One strong local model rather than a cheap
triage tier, because a triage tier measured 29% optimistic.
_Avoid_: analyzer, evaluator, grader, LLM

**Verdict**:
The judge's one-word answer: strong, possible or weak.
_Avoid_: rating, grade, label

**Facts**:
What a posting states about itself — required languages, seniority, whether it
offers sponsorship — extracted without reference to any candidate. Facts are
about the posting; fit is about the pairing.
_Avoid_: metadata, attributes, extraction

**Ghost risk**:
The reading that a posting is unlikely to be one real, active opening —
talent-pool voice, an agency advertising an unnamed employer, requirements that
contradict each other. Disclosed on the radar, never used to hide a posting.
_Avoid_: fake, spam, low quality

**Judge target**:
An open posting worth spending the judge on — scoring high enough, recent
enough or visa-marked, and somewhere the user could work. A policy about where
the GPU goes, not a statement about the pool.
_Avoid_: eligible, queued, judgeable

**Track**:
One of the user's career directions. A posting is scored against each track and
keeps its best.
_Avoid_: category, role type, discipline

**Seniority band**:
The levels one track will accept. Per track, because ten years in one field and
two in another want different answers.
_Avoid_: level filter, experience range

## Freshness

**Fresh · Aging · Evergreen**:
How a posting's claimed age reads. Evergreen means old enough that the ad is
more likely permanent than open.
_Avoid_: new, recent, old, expired

**Pool clock**:
How far the newest observation across the whole pool has advanced. Freshness is
measured against it rather than against wall-clock time, so a pause in ingesting
never ages the pool.
_Avoid_: now, timestamp, last run

## Visa

**Sponsor register**:
A government's public list of employers licensed to sponsor work visas.
_Avoid_: whitelist, sponsor list

**Sponsor-registered**:
The employer appears in its country's sponsor register. A fact about the
company, which is why it outlives any one posting.
_Avoid_: verified sponsor, approved

**Visa tier**:
The derived answer to whether this user could take this job — needed at all,
stated, likely, ruled out, or unknown. Ranks above every other ranking signal.
_Avoid_: visa status, sponsorship flag

**Visa-marked**:
Sponsor-registered, or the posting states sponsorship outright. The postings
the worker serves first.
_Avoid_: sponsored, visa jobs

## Keeping the pool judged

**Worker**:
The process that keeps the pool embedded and judged between ingests, one phase
at a time because one model fits in the GPU at a time.
_Avoid_: daemon, background job, cron

**Band**:
A broad score region worked in order — the eighties before the seventies.
Answers "which postings deserve attention next".
_Avoid_: tier, bucket, range

**Chunk**:
The unit of work inside a band: a score range holding roughly a thousand
postings, never splitting a single score value. Answers "how much to do before
showing something".
_Avoid_: batch, page, slice, segment

**Lane**:
A queue the worker serves in priority order. The visa lane sits above every
chunk lane.
_Avoid_: queue, stream, track (track means career direction)

**Pass**:
One traversal of some population by one stage — the facts pass, the judging
pass. Which pass produced a value is recorded with it.
_Avoid_: lane, round, iteration

**Backfill**:
A run that fills in what is missing or behind for postings that already exist,
as opposed to fetching new ones.
_Avoid_: migration, sync, catch-up

## Derived values

**Derivation**:
Any value computed from a posting rather than stated by it — score, fit, facts,
vector, work mode, visa tier. Derivations are recomputable; the posting is not.
_Avoid_: computed field, cache, projection

**Stamp**:
The version of whatever produced a derived value, recorded alongside it. Makes
"which system said this" answerable after the fact.
_Avoid_: tag, marker, flag

**Stale**:
A derived value whose stamp is behind the current version of the thing that
derives it. Stale is not wrong — it is a different system's answer wearing the
same name, and the radar fades it rather than hiding it.
_Avoid_: outdated, invalid, dirty, expired

**Provenance**:
Which layer established a value — a regex, the source's own structured field,
or the model. A weaker layer never overwrites a stronger one.
_Avoid_: origin, author, method
