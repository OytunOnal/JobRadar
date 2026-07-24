import { runIngest } from "../src/lib/ingest";
import { prisma } from "../src/lib/db";

const report = await runIngest();

console.log("\n=== JobRadar ingest ===");
console.log("Fetched per source:", report.perSource);
console.log(`Total fetched: ${report.fetched}`);
console.log(`Passed scoring: ${report.scored}`);
console.log(`New stored:     ${report.stored}`);
console.log(`Updated:        ${report.updated}`);
console.log(`Cross-src dupes:${report.duplicates}`);
console.log(`LLM fit-scored: ${report.fitAnalyzed}`);
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
