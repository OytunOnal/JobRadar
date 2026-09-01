import { prisma } from "../../src/lib/db";
import { AWAITING_STATUSES, TRACKED_STATUSES } from "../../src/lib/queue/pool";
import { FOLLOW_UP_DAYS } from "../../src/lib/queue/pursuit";

// PURSUITS THAT LOST THEIR CLOCK, ONE TIME ONLY.
//
// Two passes, both idempotent and both filling nulls only: the follow-up dates
// seven applications never got, and the statusAt of every pursuit written
// before that column existed.
//
// An application awaiting a reply is supposed to have both a date it was sent
// and a date to chase it. Seven of twenty-three had a gap, all of them written
// before pursuit.ts existed, none reachable from today's code:
//
//   * three (Manex, EMBL, Mintel) were stamped on 2026-08-21 by an action that
//     logged type "applied" and set no nudge at all;
//   * four (JetBrains, WhiteCircle, Mistral, Arago) have no application date
//     either — three of them touched within three minutes on 2026-08-23, the
//     signature of clicking through a list, and the fourth corroborated by an
//     action-log row whose timestamp matches its `updatedAt` to the minute.
//
// So `updatedAt` is the proxy for a missing stamp. It is only sound because
// these rows have not been touched since: ingest stopped writing to them, and
// the one row with a log entry agrees with it exactly. That is why this is a
// script and not a rule. Any application it repairs from here on would be a
// row it cannot date, and inventing dates is not a thing to leave running.
//
// The nudge is set to the stamp plus the standard window, which is what the
// code would have written at the time. Some land in the past. That is the
// point: those pursuits have been silent for weeks with nothing scheduled,
// and an overdue nudge is the honest report of it.
//
//   npx tsx scripts/backfill/pursuit-clocks.ts          # dry run
//   npx tsx scripts/backfill/pursuit-clocks.ts --write

const DAY = 86_400_000;
/** Beyond this, a write is a visit rather than the tail of an ingest statement. */
const INGEST_WRITE_MS = 60_000;
const write = process.argv.includes("--write");
const at = (d: Date) => d.toISOString().slice(0, 16).replace("T", " ");

const stranded = await prisma.job.findMany({
  where: {
    status: { in: [...AWAITING_STATUSES] },
    OR: [{ appliedAt: null }, { followUpAt: null }],
  },
  select: { id: true, company: true, title: true, status: true, appliedAt: true, followUpAt: true, updatedAt: true },
});

console.log(`${stranded.length} awaiting pursuit(s) with a gap\n`);
const now = new Date();

for (const j of stranded) {
  // Read before writing: setting appliedAt bumps updatedAt, so the proxy has
  // to be taken from the row as it stands.
  const appliedAt = j.appliedAt ?? j.updatedAt;
  const followUpAt = j.followUpAt ?? new Date(appliedAt.getTime() + FOLLOW_UP_DAYS * DAY);
  const overdue = followUpAt.getTime() <= now.getTime();

  console.log(`${j.company} / ${j.title.slice(0, 44)} [${j.status}]`);
  console.log(`  applied   ${j.appliedAt ? `${at(j.appliedAt)} (kept)` : `${at(appliedAt)} (from updatedAt)`}`);
  console.log(`  follow-up ${at(followUpAt)}${overdue ? "  <- due now" : ""}`);

  if (write) await prisma.job.update({ where: { id: j.id }, data: { appliedAt, followUpAt } });
}

// ── statusAt, for pursuits that predate the column ──────────────────────────
//
// A card reads "REJECTED · 2 days ago" off statusAt, and every row written
// before the column existed has none. Three sources, in descending order of
// how directly they witness the event:
//
//   1. THE ACTION LOG, which is the record of exactly this event. The last
//      entry that put a pursuit into the status it is still in is the answer.
//   2. `updatedAt`, BUT ONLY WHERE INGEST CANNOT EXPLAIN IT. This row's last
//      write is evidence of a user's click only if it is not just ingest
//      stamping lastSeenAt. Ingest writes both in one statement, so its gap
//      between the two is milliseconds; a click is a separate visit. Measured
//      across the thirty-one tracked rows the split is total: one row at 1 ms,
//      thirty at 16.6 hours or more, nothing in between. The threshold below
//      is therefore not load-bearing, and a minute is small enough to be
//      obviously beyond a single write and large enough to say so.
//
//      Scalable and PagerDuty are the two halves. Scalable was last seen
//      2026-08-21 15:16 and last written 2026-08-23 18:02, in the same
//      three-minute cluster as the other rows from that session, so the write
//      is the rejection. PagerDuty was seen and written one millisecond apart
//      on 2026-08-31, so its `updatedAt` says only that ingest ran.
//   3. `appliedAt`, which does not witness the event at all and is used where
//      nothing else survives. It is honest about the pursuit's beginning and
//      silent about its end, and the card's tooltip prints it as "applied",
//      so it never claims to be a rejection date.

const undated = await prisma.job.findMany({
  where: { status: { in: [...TRACKED_STATUSES] }, statusAt: null },
  select: {
    id: true, company: true, title: true, status: true,
    appliedAt: true, updatedAt: true, lastSeenAt: true,
  },
});

console.log(`\n${undated.length} tracked pursuit(s) with no statusAt`);
const sources = { "action log": 0, "user write": 0, "application date": 0 };

for (const j of undated) {
  const entered = await prisma.userActionLog.findFirst({
    where: { jobId: j.id, payload: { contains: `"to":"${j.status}"` } },
    orderBy: { at: "desc" },
    select: { at: true },
  });
  const userWrite = j.updatedAt.getTime() - j.lastSeenAt.getTime() > INGEST_WRITE_MS ? j.updatedAt : null;
  const [statusAt, source] = entered ? [entered.at, "action log" as const]
    : userWrite ? [userWrite, "user write" as const]
      : j.appliedAt ? [j.appliedAt, "application date" as const]
        : [null, null];

  if (!statusAt) {
    console.log(`  ${j.company} / ${j.title.slice(0, 34)} [${j.status}] — nothing to date it by, skipped`);
    continue;
  }
  sources[source]++;
  console.log(`  ${j.company} / ${j.title.slice(0, 34)} [${j.status}] ${at(statusAt)} (${source})`);
  if (write) await prisma.job.update({ where: { id: j.id }, data: { statusAt } });
}
console.log("  " + Object.entries(sources).map(([k, v]) => `${v} from the ${k}`).join(", "));

console.log(write ? "\nwritten." : "\ndry run — pass --write to apply.");
await prisma.$disconnect();
