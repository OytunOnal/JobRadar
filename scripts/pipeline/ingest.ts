import { runIngest } from "../../src/lib/ingest";
import { generatedProfileStale } from "../../src/lib/user/profile";
import { prisma } from "../../src/lib/db";

// --only recruitee,eures,freehire — fetch just these sources and do nothing
// else (no discovery, no probes, no liveness, no LLM). The reason it exists
// is text repair: postings whose connector has since been fixed are rewritten
// on re-sighting, and a targeted run does that in minutes where a full sweep
// takes hours and pulls half a million postings nobody asked for.
const argv = process.argv.slice(2);
const onlyIdx = argv.indexOf("--only");
const only = onlyIdx !== -1 && argv[onlyIdx + 1]
  ? argv[onlyIdx + 1].split(",").map((s) => s.trim()).filter(Boolean)
  : undefined;
if (only) console.log(`(yalnızca ${only.length} kaynak: ${only.join(", ")})`);

const report = await runIngest(only ? { only } : {});

console.log("\n=== JobRadar ingest ===");
// Discovered-board sources can number in the hundreds — summarize them.
const boardEntries = Object.entries(report.perSource).filter(([k]) => k.startsWith("board:"));
const otherSources = Object.fromEntries(
  Object.entries(report.perSource)
    .filter(([k]) => !k.startsWith("board:"))
    .map(([k, n]) => [k, n === -1 ? "cooldown" : n]), // -1 = skipped this run
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
console.log(`Too old to keep:${report.tooOld}`);
console.log(`SEO-farm junk:  ${report.junkDomain}`);
console.log(`Semantic dupes: ${report.semanticDupes}`);
console.log(`Swept (closed): ${report.delisted}`);
if (report.nameProbe) console.log(`Name probes:    ${report.nameProbe.found}/${report.nameProbe.checked} companies mapped to their ATS`);
if (report.deepProbe) console.log(`Deep probes:    ${report.deepProbe.found}/${report.deepProbe.checked} misses rescued via careers-page scan (${report.deepProbe.sitesResolved} sites resolved)`);
if (Object.keys(report.eliminated ?? {}).length > 0) console.log("Eliminated:     ", report.eliminated);
if (report.liveness) console.log(`Liveness:       ${report.liveness.boardsRefreshed} stale boards re-diffed + ${report.liveness.checked} aggregator URLs probed — ${report.liveness.expired} expired, ${report.liveness.refreshed} confirmed listed`);
if (report.sponsors) console.log(`Sponsor regs:   refreshed ${Object.entries(report.sponsors.perCountry).map(([c, n]) => `${c}:${n}`).join(" ")}${report.sponsors.errors.length ? ` (errors: ${report.sponsors.errors.length})` : ""}`);
if (report.locations) console.log(`Locations:      ${report.locations.llmResolved}/${report.locations.llmAsked} unknown strings resolved by LLM (cached forever)`);
console.log(`LLM fit-scored: ${report.fitAnalyzed}`);
if (report.harvest) {
  const h = report.harvest;
  console.log(
    `Discovery:      ${h.candidates} new ATS board candidate(s), ` +
      `${h.known} already known (${h.scanned} URLs scanned, ${h.resolved} resolved)`,
  );
  if (h.atsLikeHosts.length) console.log("  ATS-like unmatched hosts:", h.atsLikeHosts.join(", "));
}
if (generatedProfileStale) {
  console.log("NOTE: your CV changed since the profile was generated — run `npm run profile:generate` to re-aim the radar.");
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
