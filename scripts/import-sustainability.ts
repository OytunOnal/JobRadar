import { prisma } from "../src/lib/db";
import { extractSlug, type SlugHit } from "../src/lib/discovery/extract";
import { normalizeCompanyName, runNameProbes } from "../src/lib/discovery/nameprobe";
import { upsertCandidates } from "../src/lib/discovery/store";

// One-time seed from pogopaule/awesome-sustainability-jobs (CC BY-NC-SA 4.0,
// credited in the README): 221 dev-employing sustainability companies, 76%
// with a European office. The dataset is a late-2024 snapshot with ~30% link
// rot, so the durable keys are company NAME and DOMAIN — the stored careers
// URL is only trusted when it parses to a known ATS board; everything else
// goes through the name-probe funnel with the website pre-filled for deep
// probe, which re-discovers the CURRENT ats from the live site.
//
//   npx tsx --env-file=.env scripts/import-sustainability.ts [--budget N]

const args = process.argv.slice(2);
const bIdx = args.indexOf("--budget");
const BUDGET = bIdx !== -1 ? Number(args[bIdx + 1]) || 300 : 300;

const RAW =
  "https://raw.githubusercontent.com/pogopaule/awesome-sustainability-jobs/main/src/data.yaml";

interface Entry {
  name: string;
  website?: string;
  jobs?: string;
  countries: string[];
}

// The file's schema is fixed and flat — a line parser beats adding a YAML dep.
function parseCompanies(yaml: string): Entry[] {
  const companiesPart = yaml.split(/^jobportals:/m)[0];
  const out: Entry[] = [];
  let cur: Entry | null = null;
  let inGeo = false;
  for (const line of companiesPart.split("\n")) {
    const item = line.match(/^\s{2}- name:\s*(.+)$/);
    if (item) {
      if (cur) out.push(cur);
      cur = { name: item[1].trim().replace(/^["']|["']$/g, ""), countries: [] };
      inGeo = false;
      continue;
    }
    if (!cur) continue;
    const kv = line.match(/^\s{4}(website|jobs):\s*(\S+)/);
    if (kv) {
      cur[kv[1] as "website" | "jobs"] = kv[2].trim();
      inGeo = false;
      continue;
    }
    if (/^\s{4}geo:/.test(line)) {
      inGeo = true;
      continue;
    }
    const country = inGeo && line.match(/^\s+-\s*country:\s*(.+)$/);
    if (country) cur.countries.push(country[1].trim());
  }
  if (cur) out.push(cur);
  return out;
}

console.log("=== awesome-sustainability-jobs import ===");
const res = await fetch(RAW, { signal: AbortSignal.timeout(30_000) });
if (!res.ok) throw new Error(`data.yaml fetch -> HTTP ${res.status}`);
const entries = parseCompanies(await res.text());
console.log(`Parsed ${entries.length} companies`);

// 1) Careers URLs that already parse to a known ATS board — straight to the
//    candidate table (validation probes them like any discovery hit).
const hits: SlugHit[] = [];
const rest: Entry[] = [];
for (const e of entries) {
  const hit = e.jobs ? extractSlug(e.jobs) : null;
  if (hit) hits.push(hit);
  else rest.push(e);
}
const stored = await upsertCandidates(hits, "sustainability-list");
console.log(`Direct ATS links: ${hits.length} (${stored.created} new candidates, ${stored.known} already known)`);

// 2) The rest go through the tier-4 name-probe funnel; misses get their
//    website pre-filled so tier-5 deep probe skips LLM site resolution.
const report = await runNameProbes(rest.map((e) => e.name), BUDGET);
console.log(`Name-probed ${report.checked} new names — ${report.found} boards found`);

const byNorm = new Map(
  rest
    .filter((e) => e.website)
    .map((e) => {
      let host: string | undefined;
      try {
        host = new URL(e.website!).hostname.replace(/^www\./, "");
      } catch {
        host = undefined;
      }
      return [normalizeCompanyName(e.name), host] as const;
    })
    .filter((pair): pair is readonly [string, string] => Boolean(pair[1])),
);
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
console.log(`Pre-filled ${filled} websites for deep probe`);

const eu = entries.filter((e) =>
  e.countries.some((c) => !["USA", "United States", "Canada", "Australia", "India", "Remote"].includes(c)),
).length;
console.log(`(FYI: ${eu}/${entries.length} entries have a non-US/CA/AU office)`);
await prisma.$disconnect();
