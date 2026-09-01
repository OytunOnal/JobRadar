import { prisma } from "../../src/lib/db";
import { detectWorkMode } from "../../src/lib/text/workmode";

// RE-DERIVE THE WORK MODE OF EVERY UNSTAMPED ROW, ONE TIME.
//
// Every row written before workModeBy existed carries a mode with no author:
// mostly the old detector's onsite default (46.7% accurate against employer
// statements), plus its whole-description hybrid scan. This script gives each
// one an honest value: what the position-first detector reads from the stored
// text (96.3% where it speaks, on boards it never tuned on), or unknown.
//
// STRUCTURAL STATEMENTS ARE NOT LOST — they come back stronger. The adapters
// now map the employers' own dropdowns, and every live posting's next
// re-sighting stamps workModeBy="source", which this script (workModeBy:
// null) then never touches again. Run a full ingest first and the transient
// window shrinks to nothing; run this first and the same rows converge one
// ingest later. Rows on dead boards keep whatever the text can prove, which
// is all anyone can now prove about them.
//
//   npx tsx scripts/backfill/workmode-repool.ts          # dry run, counts only
//   npx tsx scripts/backfill/workmode-repool.ts --write
//
// Idempotent: everything it writes is either authored ("text") or unknown,
// and it only ever reads unauthored rows.

const write = process.argv.includes("--write");
const BATCH = 2000;

const counts = { text: { remote: 0, hybrid: 0, onsite: 0 }, unknown: 0, kept: 0 };
const was: Record<string, number> = {};
let cursor: string | undefined;

for (;;) {
  const rows = await prisma.job.findMany({
    where: { workModeBy: null },
    select: { id: true, title: true, location: true, workMode: true },
    orderBy: { id: "asc" },
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    take: BATCH,
  });
  if (rows.length === 0) break;
  cursor = rows[rows.length - 1]!.id;

  const texts = await prisma.jobContent.findMany({
    where: { jobId: { in: rows.map((r) => r.id) } },
    select: { jobId: true, description: true },
  });
  const desc = new Map(texts.map((t) => [t.jobId, t.description]));

  const byTarget: Record<string, string[]> = { remote: [], hybrid: [], onsite: [], unknown: [] };
  for (const r of rows) {
    was[r.workMode] = (was[r.workMode] ?? 0) + 1;
    const mode = detectWorkMode(r.title, r.location, desc.get(r.id) ?? "");
    if (mode) {
      counts.text[mode]++;
      if (r.workMode === mode) counts.kept++;
      byTarget[mode]!.push(r.id);
    } else {
      counts.unknown++;
      byTarget.unknown!.push(r.id);
    }
  }

  if (write) {
    for (const mode of ["remote", "hybrid", "onsite"] as const) {
      if (byTarget[mode]!.length === 0) continue;
      await prisma.job.updateMany({
        where: { id: { in: byTarget[mode]! } },
        data: { workMode: mode, workModeBy: "text" },
      });
    }
    if (byTarget.unknown!.length) {
      await prisma.job.updateMany({
        where: { id: { in: byTarget.unknown! } },
        data: { workMode: "unknown" },
      });
    }
  }

  const done = Object.values(was).reduce((s, n) => s + n, 0);
  if (done % 50_000 < BATCH) console.log(`  ...${done} rows`);
}

const spoke = counts.text.remote + counts.text.hybrid + counts.text.onsite;
const total = spoke + counts.unknown;
console.log(`\n${total} unauthored rows`);
console.log(`  was: ${Object.entries(was).map(([k, v]) => `${k}=${v}`).join("  ")}`);
console.log(`  text spoke on ${spoke} (${total ? (100 * spoke / total).toFixed(1) : 0}%): remote=${counts.text.remote} hybrid=${counts.text.hybrid} onsite=${counts.text.onsite}`);
console.log(`  unknown: ${counts.unknown}`);
console.log(write ? "written." : "dry run — pass --write to apply.");
await prisma.$disconnect();
