import { prisma } from "../src/lib/db";
import { scoreJob } from "../src/lib/score";
import { profile } from "../src/lib/profile";

// Re-run the (free, deterministic) keyword scorer over every stored job.
// Needed after the profile changes — a regenerated profile renames the track
// keys, and jobs scored under the old keys would no longer match any filter
// chip. No LLM, no network; safe to run any time.
//
//   npm run rescore

console.log("=== JobRadar rescore ===");
console.log("Tracks in effect:", profile.tracks.map((t) => t.key).join(", "));

const jobs = await prisma.job.findMany({
  select: {
    id: true, title: true, company: true, description: true,
    location: true, remote: true, source: true, externalId: true, url: true,
  },
});

let changedTrack = 0;
let disqualified = 0;
for (const j of jobs) {
  const s = scoreJob({
    source: j.source,
    externalId: j.externalId,
    url: j.url,
    title: j.title,
    company: j.company,
    location: j.location ?? undefined,
    remote: j.remote,
    description: j.description,
  });
  // Rows that no longer pass are kept (the user may have acted on them) but
  // sink: score 0 and track "other" put them behind everything relevant.
  const track = s.disqualified ? "other" : s.track;
  if (s.disqualified) disqualified++;
  const updated = await prisma.job.update({
    where: { id: j.id },
    data: { score: s.disqualified ? 0 : s.score, track, scoreReason: s.reason, scoredBy: s.scoredBy },
    select: { track: true },
  });
  if (updated.track !== track) changedTrack++; // defensive; should not happen
}

const dist = await prisma.job.groupBy({ by: ["track"], _count: true, orderBy: { _count: { track: "desc" } } });
console.log(`\nRescored ${jobs.length} jobs (${disqualified} no longer qualify under this profile).`);
console.log("Track distribution:");
for (const d of dist) console.log(`  ${(d.track ?? "-").padEnd(28)} ${d._count}`);
await prisma.$disconnect();
