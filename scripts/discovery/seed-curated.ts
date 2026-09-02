import { prisma } from "../../src/lib/db";
import { parseBound } from "../../src/lib/queue/backfill";
import { normalizeCompanyName, runNameProbes } from "../../src/lib/discovery/nameprobe";
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
// A 2026-09-02 sweep probed every ingested board for a company-directory
// door (results in docs/discovery-health.md); the two that answered joined
// below. TheMuse's public companies API (968 orgs, paginated) and
// Landing.jobs' companies API (small but website-bearing — misses get the
// site pre-filled for the deep-probe lane, the seed-vc precedent).
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

const websites = new Map<string, string>();
try {
  const lj = await (await fetch("https://landing.jobs/api/v1/companies", { ...UA, signal: AbortSignal.timeout(20_000) })).json();
  const rows = Array.isArray(lj) ? lj : [];
  console.log(`landing.jobs companies: ${rows.length}`);
  for (const c of rows) {
    if (!c?.name) continue;
    names.push(String(c.name));
    if (c.website_url) {
      try { websites.set(normalizeCompanyName(String(c.name)), new URL(String(c.website_url)).hostname.replace(/^www\./, "")); } catch { /* junk url */ }
    }
  }
} catch (e) {
  console.log(`landing.jobs harvest failed: ${(e as Error).message}`);
}
try {
  let total = 0;
  for (let page = 1; page <= 49; page++) {
    const tm = await (await fetch(`https://www.themuse.com/api/public/companies?page=${page}`, { ...UA, signal: AbortSignal.timeout(20_000) })).json();
    const rows = tm?.results ?? [];
    for (const c of rows) if (c?.name) { names.push(String(c.name)); total++; }
    if (page >= (tm?.page_count ?? 0)) break;
    await new Promise((r) => setTimeout(r, 400));
  }
  console.log(`themuse companies: ${total}`);
} catch (e) {
  console.log(`themuse harvest failed: ${(e as Error).message}`);
}

const report = await runNameProbes(names, BUDGET, undefined, undefined, "board-curated");

// Pre-fill websites on misses so deep-probe skips its LLM resolution.
let filled = 0;
if (websites.size > 0) {
  const misses = await prisma.companyProbe.findMany({
    where: { found: false, deepChecked: false, website: null },
    select: { id: true, name: true },
  });
  for (const row of misses) {
    const site = websites.get(row.name);
    if (!site) continue;
    await prisma.companyProbe.update({ where: { id: row.id }, data: { website: site } });
    filled++;
  }
}
if (filled) console.log(`websites pre-filled for the deep-probe lane: ${filled}`);
console.log(`probed ${report.checked}, boards found ${report.found}`);
const total = await prisma.atsBoard.count({ where: { discoveredVia: "board-curated" } });
console.log(`board-curated boards so far, all runs: ${total}`);
await prisma.$disconnect();
