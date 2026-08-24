import { prisma } from "../../src/lib/db";
import { normalizeCompanyName, runNameProbes } from "../../src/lib/discovery/nameprobe";

// VC-portfolio seeding: pull Y Combinator's public company list (keyless,
// paginated API — ~6.2k companies with WEBSITES) and push the names through
// the tier-4 name-probe funnel. Misses land in CompanyProbe with their
// website PRE-FILLED, so the tier-5 deep probe skips its LLM resolution step
// and goes straight to the careers-page scan on later ingests.
//
// a16z's portfolio page went fully JS-rendered (no scrapeable markers as of
// 2026-08) — YC is the only seed source for now.
//
//   npx tsx --env-file=.env scripts/seed-vc.ts [--pages N] [--budget N]
//
// Reruns are cheap: probed names are cached forever in CompanyProbe, and the
// known-company check skips boards the pool already covers. Run it a few
// times (or weekly) to walk deeper into the list.

const args = process.argv.slice(2);
function argNum(flag: string, dflt: number): number {
  const i = args.indexOf(flag);
  const v = i !== -1 ? Number(args[i + 1]) : NaN;
  return Number.isFinite(v) && v > 0 ? v : dflt;
}
const MAX_PAGES = argNum("--pages", 250); // the API had 248 pages live
const BUDGET = argNum("--budget", 150);

const UA = "JobRadar/0.1 (personal job search)";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Seed {
  name: string;
  website?: string;
}

async function fetchYc(): Promise<Seed[]> {
  const out: Seed[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    let data: any;
    try {
      const res = await fetch(`https://api.ycombinator.com/v0.1/companies?page=${page}`, {
        headers: { "User-Agent": UA, Accept: "application/json" },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) break;
      data = await res.json();
    } catch {
      break; // partial seed beats none
    }
    for (const c of data?.companies ?? []) {
      if (!c?.name) continue;
      // Dead companies still answer the API; only Active/Public hire.
      const status = String(c.status ?? "").toLowerCase();
      if (status && status !== "active" && status !== "public") continue;
      let website: string | undefined;
      try {
        website = c.website ? new URL(String(c.website)).hostname.replace(/^www\./, "") : undefined;
      } catch {
        website = undefined;
      }
      out.push({ name: String(c.name), website });
    }
    const total = Number(data?.totalPages ?? page);
    if (page >= total) break;
    await sleep(250);
  }
  return out;
}

console.log("=== VC seed: Y Combinator portfolio ===");
const seeds = await fetchYc();
console.log(`Fetched ${seeds.length} active companies (websites on ${seeds.filter((s) => s.website).length})`);

const report = await runNameProbes(seeds.map((s) => s.name), BUDGET);
console.log(`Name-probed ${report.checked} new names — ${report.found} boards found`);

// Pre-fill websites on the misses so deep-probe skips its LLM step for them.
const byNorm = new Map(seeds.filter((s) => s.website).map((s) => [normalizeCompanyName(s.name), s.website!]));
let filled = 0;
const misses = await prisma.companyProbe.findMany({
  where: { found: false, deepChecked: false, website: null },
  select: { id: true, name: true },
});
for (const row of misses) {
  const site = byNorm.get(row.name);
  if (!site) continue;
  await prisma.companyProbe.update({ where: { id: row.id }, data: { website: site } });
  filled++;
}
console.log(`Pre-filled ${filled} websites for the deep-probe lane (no LLM needed for those)`);
console.log("Rerun to walk further — probed names are cached, only new ones cost probes.");
await prisma.$disconnect();
