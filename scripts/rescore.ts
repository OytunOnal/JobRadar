import { prisma } from "../src/lib/db";
import { SCORER_VERSION } from "../src/lib/score";
import { derivedFields } from "../src/lib/derive";
import { loadLocationCache, resolveWithCache } from "../src/lib/locresolve";
import { isRegisteredSponsor } from "../src/lib/sponsors";
import { profile } from "../src/lib/profile";

// Re-run the (free, deterministic) keyword scorer over every stored job.
// Needed after the profile changes — a regenerated profile renames the track
// keys, and jobs scored under the old keys would no longer match any filter
// chip. No LLM, no network; safe to run any time.
//
//   npm run rescore

console.log("=== JobRadar rescore ===");
console.log("Tracks in effect:", profile.tracks.map((t) => t.key).join(", "));
const locationCache = await loadLocationCache().catch(() => new Map<string, string | null>());

// Version-aware: only rows not yet scored by the current scorer version.
// (A full pass anyway on first run after migration — everything is
// 'pre-migration'.) Batched to keep half a million rows out of memory.
const BATCH = 2000;
let processed = 0;

let changedTrack = 0;
let disqualified = 0;
while (true) {
  const jobs = await prisma.job.findMany({
    where: { scores: { none: { scorerVersion: SCORER_VERSION } } },
    select: {
      id: true, title: true, company: true,
      location: true, remote: true, source: true, externalId: true, url: true,
      seniorityBy: true, seniorityLevel: true, visa: true, visaBy: true,
      content: { select: { description: true } },
    },
    take: BATCH,
  });
  if (jobs.length === 0) break;
  for (const j of jobs) {
    const desc = j.content?.description ?? j.title;
    const raw = {
      source: j.source,
      externalId: j.externalId,
      url: j.url,
      title: j.title,
      company: j.company,
      location: j.location ?? undefined,
      remote: j.remote,
      description: desc,
    };
    // Rows that no longer pass are kept (the user may have acted on them) but
    // flagged: store-all semantics, never delete.
    const country = resolveWithCache(j.location, locationCache);
    const fields = derivedFields(raw, {
      country,
      sponsorReg: await isRegisteredSponsor(j.company, country),
      // The facts stage (or an earlier LLM fit) may already know this posting's
      // level and its visa answer better than any regex can. Passing the row in
      // is what keeps a re-score from demoting either.
      current: {
        visa: j.visa, visaBy: j.visaBy,
        seniorityLevel: j.seniorityLevel, seniorityBy: j.seniorityBy,
        sponsorReg: await isRegisteredSponsor(j.company, country), source: j.source, country,
      },
    });
    if (fields.disqualified) disqualified++;
    await prisma.job.update({
      where: { id: j.id },
      data: { ...fields, country },
    });
    processed++;
  }
  console.log(`  ${processed} rescored (${disqualified} disqualified so far)`);
}

const dist = await prisma.job.groupBy({ by: ["track"], _count: true, orderBy: { _count: { track: "desc" } } });
console.log(`\nRescored ${processed} jobs (${disqualified} no longer qualify under this profile).`);
const unresolved = await prisma.job.count({ where: { country: null, location: { not: null } } });
console.log(`Country unresolved (will hit the LLM next ingest): ${unresolved}`);
console.log("Track distribution:");
for (const d of dist) console.log(`  ${(d.track ?? "-").padEnd(28)} ${d._count}`);
await prisma.$disconnect();
