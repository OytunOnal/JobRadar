import { prisma } from "../src/lib/db";
import { SCORER_VERSION } from "../src/lib/score";
import { derivedFields } from "../src/lib/derive";
import { loadLocationCache, resolveWithCache } from "../src/lib/locresolve";
import { isRegisteredSponsor } from "../src/lib/sponsors";
import { profile } from "../src/lib/profile";
import { backfill } from "../src/lib/backfill";

// Re-run the (free, deterministic) keyword scorer over every stored job.
// Needed after the profile changes — a regenerated profile renames the track
// keys, and jobs scored under the old keys would no longer match any filter
// chip. No LLM, no network; safe to run any time.
//
//   npm run rescore
//   npm run rescore -- --budget 5000

// Version-aware: only rows not yet scored by the current scorer version. The
// queue consumes itself — derivedFields carries the KeywordScoreHistory row, so
// a successful write removes its own row from this predicate.
//
// That is also why this pager has no cursor, and why it was one try/catch away
// from running forever: swallow a row's error and the same 2,000 rows come back
// on every round, at full speed, printing progress. The runner's stall check is
// what makes tolerating a bad row safe here.
const BATCH = 2000;

export const rescoreWhere = { scores: { none: { scorerVersion: SCORER_VERSION } } };

export async function main() {
  console.log("=== JobRadar rescore ===");
  console.log("Tracks in effect:", profile.tracks.map((t) => t.key).join(", "));
  const locationCache = await loadLocationCache().catch(() => new Map<string, string | null>());
  let disqualified = 0;

  await backfill("rescore", {}, async (run) => {
    while (run.round()) {
      const jobs = await prisma.job.findMany({
        where: rescoreWhere,
        select: {
          id: true, title: true, company: true,
          location: true, remote: true, source: true, externalId: true, url: true,
          seniorityBy: true, seniorityLevel: true, visa: true, visaBy: true,
          content: { select: { description: true } },
        },
        take: BATCH,
      });
      if (jobs.length === 0) return run.drained();

      for (const j of jobs) {
        if (run.exhausted()) break;
        try {
          const desc = j.content?.description ?? j.title;
          const raw = {
            source: j.source, externalId: j.externalId, url: j.url,
            title: j.title, company: j.company,
            location: j.location ?? undefined, remote: j.remote,
            description: desc,
          };
          // Rows that no longer pass are kept (the user may have acted on them)
          // but flagged: store-all semantics, never delete.
          const country = resolveWithCache(j.location, locationCache);
          const sponsorReg = await isRegisteredSponsor(j.company, country);
          const fields = derivedFields(raw, {
            country,
            sponsorReg,
            // The facts stage (or an earlier LLM fit) may already know this
            // posting's level and its visa answer better than any regex can.
            // Passing the row in is what keeps a re-score from demoting either.
            current: {
              visa: j.visa, visaBy: j.visaBy,
              seniorityLevel: j.seniorityLevel, seniorityBy: j.seniorityBy,
              sponsorReg, source: j.source, country,
            },
          });
          if (fields.disqualified) disqualified++;
          await prisma.job.update({ where: { id: j.id }, data: { ...fields, country } });
          run.did();
        } catch (e) {
          run.failed(e);
        }
      }
      run.log(`  ${run.done} rescored (${disqualified} disqualified so far)`);
    }
  });

  const dist = await prisma.job.groupBy({ by: ["track"], _count: true, orderBy: { _count: { track: "desc" } } });
  console.log(`\n${disqualified} jobs no longer qualify under this profile.`);
  const unresolved = await prisma.job.count({ where: { country: null, location: { not: null } } });
  console.log(`Country unresolved (will hit the LLM next ingest): ${unresolved}`);
  console.log("Track distribution:");
  for (const d of dist) console.log(`  ${(d.track ?? "-").padEnd(28)} ${d._count}`);
  await prisma.$disconnect();
}

// The backfill runs only when this file is the entry point. Without the guard,
// importing anything from here — the queue predicate, for a test — launches a
// full re-score of the pool.
const isEntryPoint = process.argv[1]?.replace(/\\/g, "/").endsWith("rescore.ts");
if (isEntryPoint) await main();
