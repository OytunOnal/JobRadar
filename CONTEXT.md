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

**Tracked posting**:
One the user has taken into their pipeline, whether it is still open or has
ended. Pursued plus the outcomes.
_Avoid_: application, stage, my jobs

**Pursuit lifecycle**:
Everything that changes alongside a posting's status when it changes: the
applied stamp, the follow-up date, the dismissal reason, the action-log entry.
One policy with one home. It defines consequences, never permissions — any
status may follow any status, and the effects are total over every jump,
including tracking a pursuit late (straight into interview or offer).
_Avoid_: state machine, workflow, transition rules

**Awaiting a reply**:
A pursued posting where the other side still owes an answer. The only state a
follow-up nudge is for.
_Avoid_: pending, open application, waiting

**Advancing**:
A pursuit still moving under its own power: the next thing that happens to it
is another stage. Distinct from awaiting a reply, which asks who owes an
answer. A frozen req is awaited and not advancing; the two sets look alike
today and answer different questions.
_Avoid_: active, in progress, live

**Hiring paused**:
A pursuit the employer froze: the req was pulled or put on hold, and nobody
was rejected. It is awaiting a reply rather than concluded, because the only
thing that makes it worth distinguishing from a rejection is that it can come
back — and nobody will write to say so. It nudges on a slower clock than a
silent recruiter. The user giving up is dismissal, not this.
_Avoid_: on hold, frozen, cancelled, withdrawn

**Concluded**:
A pursuit that ended — an offer, a rejection, or silence long past the
follow-up date. Nothing is nudged after this.
_Avoid_: closed, finished, done

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

**Radar reading**:
Everything one render of the radar needs, read once: the page of postings, the
country chips and their counts, the stat strip, the starred shortlist, the
companies mid-application, and the label context. The chips are counted
against every filter except the country selection, so they do not jump while
one is being picked; the shortlist ignores the filters entirely.
_Avoid_: dashboard data, page props, view model

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

**Intake**:
What an ingest makes of one sighting before anything is written: the text to
read it as, whether it becomes a posting at all, and which gate — if any —
turned it away. Turned away is not the same as not stored: a gated posting is
stored and flagged. Only three things stop a sighting becoming a posting — an
SEO farm's copy, an aggregator's repost of something long dead, and a role the
same run already took from a source it trusts more.
_Avoid_: filtering, screening, validation, preprocessing

**Stage**:
One step of an ingest hung off its fetch-and-store core — the harvest, the
probes, the liveness sweep, the auto-fit, the dashboard snapshot. What makes a
stage a stage is that its failure is recorded and never sinks the run: by the
time it runs, the run has already spent its network time, and losing that to
report a harvest error is the worse trade.
_Avoid_: step, phase, task, layer

**Lean ingest**:
One that does the fetch-and-store core and no stages. A sweep slice and a
targeted text repair both want exactly this, for the same reason: they are
after postings, not after everything else an ingest normally learns.
_Avoid_: quick run, minimal, fast mode

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

**Provider chain**:
The ordered walk over configured LLM providers that every model call rides:
the first success answers, a failure falls through to the next, a provider out
of balance sits out for a while, and the chain reports itself rate-limited
only when every provider it asked was. Which provider leads is the user's
choice.
_Avoid_: fallback cascade, retry loop, LLM router

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

**Label**:
Something a posting's card says about it — a risk, a plain fact, or good news.
Every surface draws from one vocabulary, so two pages cannot make different
claims about one posting. `sponsor✓` and `sponsor?` are not two spellings of
one label — the first says the posting itself offers sponsorship, the second
says only that the company appears in a public sponsor register — and 1,920
postings once wore one on the radar and the other on the tracker, because the
two surfaces read different columns to decide which applied.

A label is the claim and its tone, not its appearance; badges and chips are
how one gets drawn.
_Avoid_: badge, chip, tag, flag

**Badge** / **Chip**:
The two ways a fact is drawn, and they are drawings rather than meanings: a
badge is what a card wears, a chip is what you click to filter by. Neither is
a synonym for label. The same visa tier is `sponsor✓` on a card and `sponsors`
in the filter bar, because a card is scanned by the hundred and a chip has to
explain itself to someone who has never seen the app. One record, two
renderings, declared on the same line so they cannot drift.

Anything on a card that is not clickable is a badge, whatever it is made of.
The age beside a pursuit's status was called a chip for a day, on the strength
of being small and round.
_Avoid_: pill, tag, token; and using either word for the fact itself

**Tone**:
Whether a label is a risk, a note, or good news. The label's meaning; the
colour is the page's business.
_Avoid_: severity, level, colour

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

**Run**:
One occupancy of the GPU: from the moment the card is taken to the moment the
last process taking part in it has gone. It carries an identity generated when
it begins, and that identity is never a process id.
_Avoid_: lock, hold, session

**Participant**:
A process taking part in a run. The worker that began the run and the backfill
it spawned are both participants, with no rank between them — either may leave
without ending the run. A participant's process id answers one question only:
whether it is still alive.
_Avoid_: owner, holder, child

**Takeover**:
Beginning a new run on a card whose previous run is over — no participant left
alive, or the run was stamped by a previous boot, whose pids mean nothing now.
Immediate, because a run with nobody in it is already over. A run whose
participants are alive on this boot is never taken, however long it has been
silent.
_Avoid_: steal, break the lock, force, reclaim

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

**Backoff ladder**:
The worker's answer to a pass that could not work: each consecutive failed or
empty pass waits longer before the next try, and any progress resets the
climb. Operates in minutes. Protects the machine while a condition clears —
memory pressure, a busy card — rather than hammering into it.
_Avoid_: retry loop, sleep

**Fail streak**:
A backfill's tolerance for bad rows: consecutive row failures end the run,
one success in between resets the count. Half of a matched pair with the
stall check — tolerating bad rows without watching progress would let a
poisoned page spin at full speed forever.
_Avoid_: error budget, retry count

**Stall check**:
The other half of that pair: rounds that make no progress end the run,
because a pager re-fetching the same rows looks exactly like slow progress
from the inside.
_Avoid_: timeout, watchdog

**Cooldown**:
A per-source floor on how often it is fetched, whatever the ingest cadence.
Rate-sensitive sources keep their own calendar, in days.
_Avoid_: throttle, rate limit (a rate limit is what the provider chain hits)

**Retry pass**:
One second chance within a single ingest for sources that failed, because a
transient network failure is common and waiting for the next ingest is
expensive. Once — a second failure waits like everyone else.
_Avoid_: retry loop

**Circuit breaker**:
A description run's per-platform give-up: a platform answering nothing this
run — rate-limited, moved, gone — is skipped for the rest of it rather than
spending the budget finding out one posting at a time.
_Avoid_: ban, blacklist

## Derived values

**Derivation**:
Any value computed from a posting rather than stated by it — score, fit, facts,
vector, work mode, visa tier. Derivations are recomputable; the posting is not.
_Avoid_: computed field, cache, projection

**Stated field**:
Something the source says about its own posting — its title, company,
location, pay. Refreshed when the source changes its mind, unlike a derivation,
which is refreshed when our own code changes.
_Avoid_: raw field, source field, metadata

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
