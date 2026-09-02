import { prisma } from "../../src/lib/db";
import { runNameProbes } from "../../src/lib/discovery/nameprobe";

// SEED DISCOVERY FROM THE VISA SPONSOR REGISTERS (#13).
//
// Every name in VisaSponsor is a company its government lists as able to
// sponsor — so every board this finds belongs to an employer whose
// sponsorship is a matter of public record, and its postings enter the
// judge's visa lane the ingest after it lands. This grows the metric that
// matters (density of useful postings), not the raw count.
//
// Deliberately a HAND-RUN, BUDGETED script rather than an ingest stage: the
// registers hold ~147k names, most of them care homes and restaurants, and a
// name costs 10-60s of polite probing. The CompanyProbe cache is the resume
// point — a name is never probed twice under the same coverage — so any
// budget makes progress and no run repeats another's work. Whether this earns
// a place in the daily rhythm is decided when the numbers exist, not before.
//
// Register order is the user's: NL first, then IE, DK, and GB only if the
// first three's hit rate says the 126k-name sweep is worth weeks of probing.
//
//   npx tsx scripts/discovery/seed-sponsors.ts                 # 200 names
//   npx tsx scripts/discovery/seed-sponsors.ts --budget 991
//   npx tsx scripts/discovery/seed-sponsors.ts --country nl    # one register only
//
// Report per country: names probed, boards found. Quote the queue gauges
// before promoting this to any schedule — every hit feeds the visa lane.

const COUNTRY_ORDER = ["nl", "ie", "dk", "gb"] as const;

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : undefined;
};
const BUDGET = Number(flag("--budget")) || 200;
const ONLY = flag("--country");

let remaining = BUDGET;
for (const country of COUNTRY_ORDER) {
  if (ONLY && country !== ONLY) continue;
  if (remaining <= 0) break;
  const names = await prisma.visaSponsor.findMany({
    where: { country },
    orderBy: { name: "asc" },
    select: { name: true },
  });
  if (names.length === 0) continue;
  console.log(`\n${country}: ${names.length.toLocaleString("en")} register names, budget ${remaining}`);
  const report = await runNameProbes(
    names.map((n) => n.name),
    remaining,
    undefined,
    undefined,
    "sponsor-register",
  );
  console.log(`${country}: probed ${report.checked}, boards found ${report.found}`);
  remaining -= report.checked;
}

const total = await prisma.atsBoard.count({ where: { discoveredVia: "sponsor-register" } });
console.log(`\nsponsor-register boards so far, all runs: ${total}`);
await prisma.$disconnect();
