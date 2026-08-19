import { runIngest } from "../src/lib/ingest";
import { prisma } from "../src/lib/db";

const report = await runIngest();

console.log("\n=== JobRadar ingest ===");
// Discovered-board sources can number in the hundreds — summarize them.
const boardEntries = Object.entries(report.perSource).filter(([k]) => k.startsWith("board:"));
const otherSources = Object.fromEntries(
  Object.entries(report.perSource).filter(([k]) => !k.startsWith("board:")),
);
console.log("Fetched per source:", otherSources);
if (boardEntries.length) {
  const boardJobs = boardEntries.reduce((sum, [, n]) => sum + n, 0);
  console.log(`Discovered boards: ${boardEntries.length} fetched -> ${boardJobs} jobs`);
}
console.log(`Total fetched: ${report.fetched}`);
console.log(`Passed scoring: ${report.scored}`);
console.log(`New stored:     ${report.stored}`);
console.log(`Updated:        ${report.updated}`);
console.log(`Cross-src dupes:${report.duplicates}`);
console.log(`LLM fit-scored: ${report.fitAnalyzed}`);
if (report.harvest) {
  const h = report.harvest;
  console.log(
    `Discovery:      ${h.candidates} new ATS board candidate(s), ` +
      `${h.known} already known (${h.scanned} URLs scanned, ${h.resolved} resolved)`,
  );
  if (h.atsLikeHosts.length) console.log("  ATS-like unmatched hosts:", h.atsLikeHosts.join(", "));
}
if (report.errors.length) console.log("Errors:", report.errors);

const top = await prisma.job.findMany({
  orderBy: { score: "desc" },
  take: 10,
  select: { score: true, track: true, title: true, company: true, location: true },
});
console.log("\nTop matches:");
for (const j of top) {
  console.log(`  [${j.score}] ${j.track?.padEnd(9)} ${j.title} @ ${j.company} (${j.location ?? "?"})`);
}

await prisma.$disconnect();
