import { prisma } from "../src/lib/db";
import { profile } from "../src/lib/profile";
import { deriveVisaTier } from "../src/lib/visa";

// Recompute the derived visaTier across the pool. Needed after: a profile
// change (workAuthorization!), a sponsor-register refresh, or a drift report
// from `npm run doctor`. Pure local computation — no network, no LLM.
//
//   npm run visa:retier

const BATCH = 5000;
let cursor = "";
let scanned = 0;
let changed = 0;
for (;;) {
  const rows = await prisma.job.findMany({
    where: { id: { gt: cursor } },
    orderBy: { id: "asc" },
    take: BATCH,
    select: { id: true, visa: true, sponsorReg: true, source: true, country: true, visaTier: true },
  });
  if (rows.length === 0) break;
  cursor = rows[rows.length - 1].id;
  scanned += rows.length;
  const updates = rows
    .map((r) => ({ r, tier: deriveVisaTier(r, profile.workAuthorization) }))
    .filter(({ r, tier }) => tier !== r.visaTier);
  for (const { r, tier } of updates) {
    await prisma.job.update({ where: { id: r.id }, data: { visaTier: tier } });
  }
  changed += updates.length;
  if (scanned % 50000 < BATCH) console.log(`  ${scanned} scanned, ${changed} retiered`);
}
console.log(`=== done: ${scanned} scanned, ${changed} retiered ===`);
const dist = await prisma.job.groupBy({ by: ["visaTier"], _count: true, where: { disqualified: false, delistedAt: null } });
for (const d of dist) console.log(`  ${d.visaTier.padEnd(12)} ${d._count}`);
await prisma.$disconnect();
