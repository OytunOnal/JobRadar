import { prisma } from "../../src/lib/db";
import { normalizeLocation } from "../../src/lib/location/geo";
import { resolveUnknownLocations, LLM_BATCH_LIMIT } from "../../src/lib/location/locresolve";

// Backlog filler for location resolution: the sweep stored thousands of jobs
// whose location strings the gazetteer didn't know. Each batch resolves up to
// 80 unique strings in ONE fast-tier call and writes both the cache and the
// jobs. Strings already in LocationCache (including cached "couldn't tell"
// nulls) are never re-asked.
//
//   npm run locations:fill

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let totalAsked = 0;
let totalResolved = 0;

for (let round = 1; round <= 40; round++) {
  const rows = await prisma.job.findMany({
    where: { country: null, location: { not: null }, delistedAt: null },
    select: { location: true },
    distinct: ["location"],
  });
  const cached = new Set(
    (await prisma.locationCache.findMany({ select: { raw: true } })).map((r) => r.raw),
  );
  const unknown = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!r.location) continue;
    const key = normalizeLocation(r.location);
    if (cached.has(key)) continue;
    if (!unknown.has(key)) unknown.set(key, new Set());
    unknown.get(key)!.add(r.location);
  }
  if (unknown.size === 0) {
    console.log("Çözülecek yeni konum kalmadı.");
    break;
  }
  console.log(`round ${round}: ${unknown.size} benzersiz bilinmeyen (bu partide ${Math.min(unknown.size, LLM_BATCH_LIMIT)})`);
  const report = await resolveUnknownLocations(unknown);
  totalAsked += report.llmAsked;
  totalResolved += report.llmResolved;
  console.log(`  soruldu ${report.llmAsked}, çözüldü ${report.llmResolved}`);
  if (report.llmAsked === 0) break; // LLM answered nothing — chain exhausted
  await sleep(3_000);
}

const left = await prisma.job.count({ where: { country: null, location: { not: null }, delistedAt: null } });
console.log(`\nToplam: ${totalAsked} soruldu, ${totalResolved} çözüldü. Ülkesiz kalan ilan: ${left} (cache'e "bilinmiyor" yazılanlar dahil).`);
await prisma.$disconnect();
