import { prisma } from "../src/lib/db";
import { scoreJob, SCORER_VERSION } from "../src/lib/score";
import type { SeniorityLevel } from "../src/lib/seniority";
import { deriveWorkMode } from "../src/lib/sources/types";
import { loadLocationCache, resolveWithCache } from "../src/lib/locresolve";
import { detectVisa } from "../src/lib/visa";
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
      seniorityBy: true, seniorityLevel: true,
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
    // The facts stage (or an earlier LLM fit) may already know this posting's
    // level better than any regex can — judge the band against that.
    const s = scoreJob(raw, {
      knownLevel: j.seniorityBy === "llm" && j.seniorityLevel
        ? (j.seniorityLevel as SeniorityLevel)
        : undefined,
    });
    // Rows that no longer pass are kept (the user may have acted on them) but
    // flagged: store-all semantics, never delete.
    const track = s.disqualified ? "other" : s.track;
    if (s.disqualified) disqualified++;
    await prisma.job.update({
      where: { id: j.id },
      data: {
        score: s.disqualified ? 0 : s.score, track, scoreReason: s.reason, scoredBy: s.scoredBy,
        disqualified: s.disqualified,
        langReq: s.langReq || null,
        ...(j.seniorityBy === "llm" ? {} : {
          seniorityLevel: s.seniorityLevel === "unknown" ? null : s.seniorityLevel,
          seniorityBy: s.seniorityLevel === "unknown" ? null : "detector",
        }),
        workMode: deriveWorkMode(raw), country: resolveWithCache(j.location, locationCache),
        visa: detectVisa(desc, j.title),
        sponsorReg: await isRegisteredSponsor(j.company, resolveWithCache(j.location, locationCache)),
        scores: {
          create: {
            scorerVersion: SCORER_VERSION, score: s.disqualified ? 0 : s.score, track: s.track,
            reason: s.reason, disqualified: s.disqualified, at: new Date(),
          },
        },
      },
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
