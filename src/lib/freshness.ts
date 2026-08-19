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

// Short human age for the dashboard ("3d", "2mo", "1y+").
export function ageLabel(anchor: Date, now: Date = new Date()): string {
  const days = Math.max(0, Math.floor((now.getTime() - anchor.getTime()) / DAY));
  if (days < 1) return "today";
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return "1y+";
}
