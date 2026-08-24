import { prisma } from "../../src/lib/db";
import { runCrawl, type CrawlOptions } from "../../src/lib/discovery/crawl";

// Bulk discovery sweep over the web archives. Meant to run monthly (Common
// Crawl publishes one snapshot a month) or once at setup.
//
//   npm run discovery:crawl                          # everything (10-20 min)
//   npm run discovery:crawl -- --platform=personio   # one platform
//   npm run discovery:crawl -- --source=commoncrawl --snapshots=1
//   npm run discovery:crawl -- --source=wayback

const opts: CrawlOptions = { log: (m) => console.log("  " + m) };
for (const arg of process.argv.slice(2)) {
  const [k, v] = arg.split("=");
  if (k === "--platform") opts.platformIds = v.split(",");
  else if (k === "--source") opts.sources = v.split(",") as CrawlOptions["sources"];
  else if (k === "--snapshots") opts.snapshots = Number(v);
  else if (k === "--wayback-limit") opts.waybackLimit = Number(v);
}

console.log("=== JobRadar bulk discovery crawl ===");
const report = await runCrawl(opts);

console.log(`\nURLs seen:        ${report.urls}`);
console.log(`Unique boards:    ${report.hits}`);
console.log(`New candidates:   ${report.created}`);
console.log(`Already known:    ${report.known}`);
for (const [domain, n] of Object.entries(report.perDomain)) {
  console.log(`  ${domain}: ${n} hits`);
}
if (report.truncated.length) {
  console.log("Coverage incomplete (row limit hit):", report.truncated.join(", "));
}
if (report.errors.length) console.log("Errors:", report.errors);

const counts = await prisma.atsBoard.groupBy({ by: ["status"], _count: true });
console.log("Board table:", counts.map((c) => `${c.status}=${c._count}`).join(", "));
await prisma.$disconnect();
