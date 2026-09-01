import { prisma } from "../../src/lib/db";
import { AWAITING_STATUSES } from "../../src/lib/queue/pool";
import { FOLLOW_UP_DAYS } from "../../src/lib/queue/pursuit";

// PURSUITS THAT LOST THEIR CLOCK, ONE TIME ONLY.
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

console.log(write ? "\nwritten." : "\ndry run — pass --write to apply.");
await prisma.$disconnect();
