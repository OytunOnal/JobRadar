import { prisma } from "../../src/lib/db";
import { parseBound } from "../../src/lib/queue/backfill";
import { runNameProbes } from "../../src/lib/discovery/nameprobe";
import { fetchSpainSponsorCompanies } from "../../src/lib/sources/spainjobsio";
import { companiesFromSitemap } from "../../src/lib/sources/nextleveljobs";

// SEED DISCOVERY FROM CURATED SPONSOR LISTS published by the visa-focused
// boards themselves (#25/#26). Two feeds today, same pipe as every seeding
// lane — CompanyProbe cache resumes, provenance says which pipe:
//
//   * SpainJobs.io /companies/visa-sponsors — its editorial list of Spanish
//     sponsor companies (~16 names).
//   * Next Level Jobs EU — every distinct company in its job sitemap
//     (~hundreds); the board is sponsor-curated, so presence IS the signal.
//     The scan's caveat applies: many are big names our ATS discovery
//     already covers, and runNameProbes' known-board check skips those free.
//
//   npx tsx --env-file=.env scripts/discovery/seed-curated.ts [--budget 200]

const BUDGET = parseBound(process.argv.slice(2), 200);

const UA = { headers: { "User-Agent": "JobRadar/0.1 (personal job search)" } };
const names: string[] = [];

try {
  const es = await fetchSpainSponsorCompanies();
  console.log(`spainjobs.io sponsors: ${es.length}`);
  names.push(...es);
} catch (e) {
  console.log(`spainjobs.io harvest failed: ${(e as Error).message}`);
}
try {
  const xml = await (await fetch("https://nextleveljobs.eu/jobs/sitemap.xml", { ...UA, signal: AbortSignal.timeout(30_000) })).text();
  const nlj = companiesFromSitemap(xml).map((slug) => slug.replace(/-/g, " "));
  console.log(`nextleveljobs.eu sitemap companies: ${nlj.length}`);
  names.push(...nlj);
} catch (e) {
  console.log(`nextleveljobs.eu harvest failed: ${(e as Error).message}`);
}

const report = await runNameProbes(names, BUDGET, undefined, undefined, "board-curated");
console.log(`probed ${report.checked}, boards found ${report.found}`);
const total = await prisma.atsBoard.count({ where: { discoveredVia: "board-curated" } });
console.log(`board-curated boards so far, all runs: ${total}`);
await prisma.$disconnect();
