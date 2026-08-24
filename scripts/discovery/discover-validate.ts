import { prisma } from "../../src/lib/db";
import { seedCuratedBoards } from "../../src/lib/discovery/boardSources";
import { runValidation } from "../../src/lib/discovery/validate";

// Probes every AtsBoard that is a candidate, was never validated, or is due
// its 30-day recheck. Usage:
//   npm run discovery:validate            # everything due
//   npm run discovery:validate -- 100     # cap this run at 100 probes

// The hand-curated companies.ts list validates like everything else — this is
// what catches stale/wrong curated tokens (the gh:peak case).
const seeded = await seedCuratedBoards();
if (seeded) console.log(`Seeded ${seeded} curated companies into the board table.`);

const limit = process.argv[2] ? Number(process.argv[2]) : undefined;
const report = await runValidation({ limit });

console.log("\n=== JobRadar board validation ===");
console.log(`Checked: ${report.checked}`);
console.log(`Active:  ${report.active}${report.revived ? ` (${report.revived} revived)` : ""}`);
console.log(`Dead:    ${report.dead}`);
console.log(`Errors:  ${report.errors} (left untouched, retried next run)`);

const counts = await prisma.atsBoard.groupBy({ by: ["status"], _count: true });
console.log("Board table:", counts.map((c) => `${c.status}=${c._count}`).join(", "));
await prisma.$disconnect();
