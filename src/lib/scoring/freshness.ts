// Freshness: is this posting still worth a spot on the board?
//
// Two independent signals, because each lies in a different way:
//   - postedAt     — the source's claim. Evergreen ATS postings carry ancient
//                    dates (Lever createdAt from 2019) yet stay listed forever.
//   - lastSeenAt   — our observation. A direct-source job that stops appearing
//                    on its board is closed, whatever its postedAt says.
//
// Classification is DERIVED at read time, never stored: a job's freshness
// changes as time passes even when the row doesn't.

const DAY = 86_400_000;

// Anchor age below this → fresh.
export const FRESH_MAX_DAYS = 45;
// Anchor age beyond this while still listed → evergreen/talent-pool posting.
export const EVERGREEN_MIN_DAYS = 180;
// Direct-source job not seen at its board for this long → delisted (closed).
export const DELISTED_AFTER_DAYS = 14;
// Aggregator posts older than this are not even worth storing.
export const AGGREGATOR_MAX_AGE_DAYS = 45;

export type Freshness = "fresh" | "aging" | "evergreen" | "delisted";

export interface FreshnessInput {
  postedAt: Date | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  source: string;
  // Set by the ingest sweep when the job vanished from its board's feed.
  delistedAt?: Date | null;
}

// Direct sources (ATS fetchers) use "prefix:token" source ids; aggregators
// are bare names. Only direct sources re-list jobs reliably enough to infer
// "gone" from absence.
function isDirectSource(source: string): boolean {
  return source.includes(":");
}

// `poolNewest` — the newest lastSeenAt across the whole pool — guards the
// delisted check against a paused system: if WE stopped ingesting, nothing
// was re-seen and absence means nothing. A job is only "delisted" when the
// pool moved on without it.
export function classifyFreshness(
  job: FreshnessInput,
  now: Date = new Date(),
  poolNewest?: Date,
): Freshness {
  // The sweep saw the board WITHOUT this job — closed, no grace needed.
  if (job.delistedAt) return "delisted";
  if (isDirectSource(job.source) && poolNewest) {
    const poolAdvance = poolNewest.getTime() - job.lastSeenAt.getTime();
    if (poolAdvance > DELISTED_AFTER_DAYS * DAY) return "delisted";
  }
  const anchor = job.postedAt ?? job.firstSeenAt;
  const ageDays = (now.getTime() - anchor.getTime()) / DAY;
  if (ageDays > EVERGREEN_MIN_DAYS) return "evergreen";
  if (ageDays > FRESH_MAX_DAYS) return "aging";
  return "fresh";
}

// Ingest guard: an aggregator repost of an old listing is noise — don't store
// it at all. Direct-source jobs are stored regardless (classification handles
// them; the company really does list the role).
export function tooOldToStore(
  postedAt: Date | undefined | null,
  isAggregator: boolean,
  now: Date = new Date(),
): boolean {
  if (!isAggregator || !postedAt) return false;
  return now.getTime() - postedAt.getTime() > AGGREGATOR_MAX_AGE_DAYS * DAY;
}

/** CALENDAR days between then and now, in local time, never negative. Both
 * renderings below count from this, so they cannot disagree about where a day
 * ends — and the day ends at midnight, not 24 hours after the event. The
 * elapsed-time version shipped first and called yesterday's applications
 * "today" until each one's own clock time came around again: apply at noon,
 * and at breakfast the next day the card still says today. "Yesterday" is a
 * date, not a duration. Rounded, not floored, so a DST-shortened day still
 * counts as one. */
export function daysSince(anchor: Date, now: Date = new Date()): number {
  const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.max(0, Math.round((midnight(now) - midnight(anchor)) / DAY));
}

// Short human age for the dashboard ("3d", "2mo", "1y+").
export function ageLabel(anchor: Date, now: Date = new Date()): string {
  const days = daysSince(anchor, now);
  if (days < 1) return "today";
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return "1y+";
}

// THE SAME AGE, IN WORDS ("yesterday", "3 days ago", "2 months ago").
//
// A dense list scanned by the hundred wants "3d"; a single chip in a card's
// corner can afford to speak. That is a difference of register, not of
// meaning, so the two live on the same thresholds and count the same days.
//
// It renders the whole phrase rather than a stem callers add "ago" to. The
// stem version already shipped once and said "applied today ago" on every
// card written in the last day, because the shortest honest answer is a word
// that takes no suffix — and "1y+ ago" was waiting behind it.
export function ageWords(anchor: Date, now: Date = new Date()): string {
  const days = daysSince(anchor, now);
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  if (days < 365) {
    const months = Math.floor(days / 30);
    return months === 1 ? "1 month ago" : `${months} months ago`;
  }
  return "over a year ago";
}
