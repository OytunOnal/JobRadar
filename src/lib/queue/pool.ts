// WHICH POSTINGS COUNT.
//
// Every reader of the pool — the radar, the worker, five backfill scripts, the
// health panel — has to answer this before it can do anything, and until this
// module existed each of them answered it by hand. A census found `duplicateOfId:
// null` written 17 times across 11 files, and 14 distinct populations where
// there should have been six. No two of {radar list, starred strip, judging
// queue, facts queue, embedding queue, health panel} agreed.
//
// The drift was not hypothetical. Four incidents are recorded in comments
// elsewhere in this repo — the worker counting 71,968 postings and working
// 26,417 of them (a 33-hour stall), a queue of 67k against a queue of 21k, a
// visa filter erased by a spread, 445,358 vectors permanently stale — and every
// one of them was one copy of a rule drifting from another. Each was fixed by
// correcting the copy. None was fixed by naming the rule.
//
// TWO AXES, DELIBERATELY SEPARATE. This module owns POPULATION: which postings
// are in play, structurally. It does not own WORK NEEDED (`unjudgedWhere` in
// fit.ts, `staleVectorWhere` in embed.ts) or POLICY (`judgeTargetWhere` in
// fit.ts — score, freshness, target countries). Those vary independently: a new
// kind of work does not change the pool, and a new reader does not change the
// work. Callers multiply the axes with andWhere:
//
//   andWhere(openWhere(), judgeTargetWhere(true, now), unjudgedWhere())
//
// That separation is what lets a child process express the same lane its parent
// counted. embed-fill could not import `judgeableWhere` because judging was
// baked into it; it can import `openWhere`.
//
// The vocabulary here is CONTEXT.md's, exactly: live, open, discoverable,
// pursued, dismissed, archive.

// The statuses, named. Exported because the pages render them as chips and a
// second hand-written list of the same strings is how this file's problem
// starts over.
//
// `status` is the one column in the pool that belongs to the USER rather than
// the pipeline: ingest never writes it (the schema default makes every new
// posting "new") and exactly two server actions do. So it is the axis on which
// readers legitimately differ, which is precisely why each set gets a name
// rather than being spelled out at the call site.
export const OPEN_STATUSES = ["new", "interested"] as const;
export const DISCOVERABLE_STATUSES = ["new"] as const;
// `stopped` is the employer's pause, not yours: they froze the req, nobody
// rejected you, and one day somebody will unfreeze it without telling you. It
// is pursued rather than concluded for exactly that reason. Marked concluded
// it would differ from `rejected` only in spelling, and the one fact worth
// keeping — that it can come back — would be the fact thrown away. Giving up
// on a pursuit is `ignored`; this is the other side giving up on the calendar.
export const PURSUED_STATUSES = ["applied", "interview", "stopped", "offer"] as const;
// Pursued, plus the two ways a pursuit ends. /applied groups by these, and it
// used to keep its own hand-written copy of the list — twice in one file, once
// for the query and once for the stage buttons.
export const TRACKED_STATUSES = [...PURSUED_STATUSES, "rejected", "ghosted"] as const;
// Pursued and still waiting on the other side. These are the ones a follow-up
// nudge is FOR — /applied had this pair written out twice, once to pick the
// "due today" list and once to decide which cards get the +3d/+7d buttons.
//
// A frozen req is still something you are waiting on, so it nudges — just on a
// slower clock than a silent recruiter. pursuit.ts owns how slow.
export const AWAITING_STATUSES = ["applied", "interview", "stopped"] as const;
// The three ways a pursuit is over. Nothing needs nudging after one of these.
export const CONCLUDED_STATUSES = ["offer", "rejected", "ghosted"] as const;
export const DISMISSED_STATUS = "ignored" as const;

export function isAwaitingReply(status: string): boolean {
  return (AWAITING_STATUSES as readonly string[]).includes(status);
}

export function isConcluded(status: string): boolean {
  return (CONCLUDED_STATUSES as readonly string[]).includes(status);
}

// Combine Prisma filters without one silently erasing another.
//
// Spreading two filter objects into one looks like composition and is not:
// `{...a, ...b}` keeps only b's `OR`, only b's `AND`, only b's `score`. That
// cost us two silent bugs — a visa filter that vanished (the worker queued
// 72,111 postings instead of 3,509) and a staleness check that matched
// nothing. Every part lands in the AND list here, so nothing can be shadowed.
//
// It lives in this module because it is the tool that makes the populations
// below composable; a caller that has one without the other is back to
// hand-assembly.
export function andWhere(...parts: Array<Record<string, unknown> | null | undefined>) {
  return { AND: parts.filter(Boolean) as Record<string, unknown>[] };
}

// A LIVE POSTING: not disqualified, not a duplicate, not delisted.
//
// Status-free on purpose. "Live" is a fact about the posting and the pool;
// whether the user has acted on it is a different question, answered by the
// populations below. Keeping them apart is what stops a reader from having to
// spell out four columns to express one idea.
//
// All three keys are distinct scalar columns, so the spreads below cannot
// shadow anything — unlike composition involving AND/OR, which must go through
// andWhere.
export function liveWhere() {
  return { disqualified: false, delistedAt: null, duplicateOfId: null };
}

// An OPEN POSTING: live, and the user has neither dismissed it nor started
// pursuing it. What every work queue is about.
//
// The work queues did not use to say this. 40 query sites constrained no
// status at all, so embed-fill, desc-fill, rescore and the facts queue were all
// spending time on postings the user had explicitly said no to. Sixty of them,
// which is nothing today and is the wrong shape at any size: a queue's name and
// the set it covers should say the same thing.
export function openWhere() {
  return { ...liveWhere(), status: { in: [...OPEN_STATUSES] } };
}

// A DISCOVERABLE POSTING: open, and the user has not reacted to it at all.
// The radar's population.
//
// Separate from `openWhere` because "interested" postings render in their own
// strip above the list rather than in it — the radar is for finding work, and a
// posting you have already starred has been found.
export function discoverableWhere() {
  return { ...liveWhere(), status: { in: [...DISCOVERABLE_STATUSES] } };
}

// Postings the user has applied to and is tracking.
//
// Deliberately NOT anchored to liveWhere: a posting you applied to stays yours
// after its source drops it. The /applied page shows the closure as a warning
// rather than dropping the row.
export function pursuedWhere() {
  return { status: { in: [...PURSUED_STATUSES] } };
}

// Everything the user has taken into their pipeline, including the ones that
// ended. Like pursuedWhere, deliberately not anchored to liveWhere: an
// application outlives its posting.
export function trackedWhere() {
  return { status: { in: [...TRACKED_STATUSES] } };
}

// Postings the user said no to. They stay in the pool as labelled feedback —
// dismissal reasons are the most valuable training data this system has — and
// leave every work queue.
export function dismissedWhere() {
  return { status: DISMISSED_STATUS };
}

// The gate-rejected part of the pool. Stored rather than dropped (store-all)
// so a scorer fix is a re-score, and worked only when nothing else needs the
// GPU.
export function archiveWhere() {
  return { disqualified: true, delistedAt: null, duplicateOfId: null };
}
