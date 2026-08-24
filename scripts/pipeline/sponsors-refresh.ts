import { refreshSponsors } from "../../src/lib/visa/sponsors";
import { prisma } from "../../src/lib/db";

// Refresh the public visa-sponsor registers (NL IND, UK Home Office, DK SIRI,
// IE DETE). Weekly is plenty; ingest also auto-refreshes when >14 days stale.
//
//   npm run sponsors

console.log("=== Visa sponsor registers ===");
const report = await refreshSponsors();
for (const [country, n] of Object.entries(report.perCountry)) {
  console.log(`  ${country}: ${n} sponsors`);
}
for (const e of report.errors) console.log(`  ERROR ${e}`);
await prisma.$disconnect();
process.exit(report.errors.length > 0 && Object.keys(report.perCountry).length === 0 ? 1 : 0);
