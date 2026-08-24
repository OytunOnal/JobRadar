import { prisma } from "../../src/lib/db";
import { runHfDiscovery } from "../../src/lib/discovery/hfDataset";

// Discovery from the open-apply-jobs Hugging Face dataset (daily Ashby /
// Greenhouse / Lever scrapes). Reads only the latest date partition, only two
// columns, over HTTP byte ranges — a few MB, not the 30GB dataset.
//
//   npm run discovery:hf

console.log("=== JobRadar HF-dataset discovery ===");
const report = await runHfDiscovery({ log: (m) => console.log("  " + m) });

console.log(`\nPartition:      ${report.partitionDate} (${report.files} files)`);
console.log(`Rows read:      ${report.rows}`);
console.log(`Unique boards:  ${report.hits}`);
console.log(`New candidates: ${report.created}`);
console.log(`Already known:  ${report.known}`);
if (report.errors.length) console.log("Errors:", report.errors);

const counts = await prisma.atsBoard.groupBy({ by: ["status"], _count: true });
console.log("Board table:", counts.map((c) => `${c.status}=${c._count}`).join(", "));
await prisma.$disconnect();
