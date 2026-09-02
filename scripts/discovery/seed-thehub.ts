import { prisma } from "../../src/lib/db";
import { parseBound } from "../../src/lib/queue/backfill";
import { normalizeCompanyName, probeableName, runNameProbes } from "../../src/lib/discovery/nameprobe";

// SEED DISCOVERY FROM THE HUB'S STARTUP DIRECTORY (#21, final slice).
//
// thehub.io/startups is the one company directory among our ingested boards
// with an open door: paginated server-rendered pages (~17 startups each,
// 50+ pages), and each startup's detail page names its website. The website
// is the valuable half — misses get it PRE-FILLED on CompanyProbe, so the
// deep-probe lane later scans the careers page without spending an LLM call
// to resolve the domain (the seed-vc precedent).
//
// The jobs feed already surfaces companies with LIVE postings; the
// directory's marginal value is the rest — startups between hiring rounds,
// whose boards exist before their next posting does.
//
//   npx tsx --env-file=.env scripts/discovery/seed-thehub.ts [--budget 150] [--pages 20]

const args = process.argv.slice(2);
const BUDGET = parseBound(args, 150);
const pagesIdx = args.indexOf("--pages");
const MAX_PAGES = pagesIdx !== -1 ? Number(args[pagesIdx + 1]) || 20 : 20;

const UA = { headers: { "User-Agent": "JobRadar/0.1 (personal job search)" } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const get = async (url: string): Promise<string> => {
  const res = await fetch(url, { ...UA, redirect: "follow", signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.text();
};

// ── Collect slugs from the paginated directory ──────────────────────────────
const slugs = new Set<string>();
for (let page = 1; page <= MAX_PAGES; page++) {
  let html: string;
  try { html = await get(`https://thehub.io/startups?page=${page}`); } catch { break; }
  const before = slugs.size;
  for (const m of html.matchAll(/href="\/startups\/([a-z0-9-]+)"/g)) slugs.add(m[1]!);
  if (slugs.size === before) break; // ran off the end
  await sleep(600);
}
console.log(`directory slugs collected: ${slugs.size} (${MAX_PAGES} pages max)`);

// ── Resolve name + website per startup, skipping cached names ───────────────
const probed = new Set((await prisma.companyProbe.findMany({ select: { name: true } })).map((p) => p.name));
const seeds: Array<{ name: string; website?: string }> = [];
for (const slug of slugs) {
  if (seeds.length >= BUDGET) break;
  // The slug is a lowercase name; skip the detail fetch when the cache
  // already knows the company under that reading.
  if (probed.has(normalizeCompanyName(slug.replace(/-/g, " ")))) continue;
  let html: string;
  try { html = await get(`https://thehub.io/startups/${slug}`); } catch { continue; }
  const name = html.match(/<title>The Hub \| ([^<]+)</)?.[1]?.trim() ?? slug.replace(/-/g, " ");
  if (!probeableName(name) || probed.has(normalizeCompanyName(name))) continue;
  const website = html.match(/[Ww]ebsite[\s\S]{0,200}?href="(https?:\/\/(?!thehub)[^"]+)"/)?.[1]
    ?? html.match(/href="(https?:\/\/(?!thehub\.io|twitter|x\.com|linkedin|facebook|instagram)[^"]+)"[^>]*>\s*(?:Visit )?[Ww]ebsite/)?.[1];
  let host: string | undefined;
  try { host = website ? new URL(website).hostname.replace(/^www\./, "") : undefined; } catch { /* junk href */ }
  seeds.push({ name, website: host });
  await sleep(400);
}
console.log(`new startups resolved: ${seeds.length} (websites on ${seeds.filter((s) => s.website).length})`);

// ── Probe, then pre-fill websites on the misses ─────────────────────────────
const report = await runNameProbes(seeds.map((s) => s.name), BUDGET, undefined, undefined, "thehub-directory");
console.log(`probed ${report.checked}, boards found ${report.found}`);

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
console.log(`websites pre-filled for the deep-probe lane: ${filled}`);
await prisma.$disconnect();
