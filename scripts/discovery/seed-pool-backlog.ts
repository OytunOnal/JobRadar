import { prisma } from "../../src/lib/db";
import { parseBound } from "../../src/lib/queue/backfill";
import { backlogNames, runNameProbes } from "../../src/lib/discovery/nameprobe";

// DRAIN THE POOL'S OWN PROBE BACKLOG (#21's lane, runnable by hand).
//
// The ingest probes up to NAME_PROBE_MAX backlog names per run; this script
// is the same lane without waiting for an ingest — for the one-time drain
// after the lane landed (6,413 unprobed companies at that moment) and for
// any later catch-up. Same ordering (best posting score first), same cache,
// same provenance; running it twice wastes nothing.
//
//   npx tsx --env-file=.env scripts/discovery/seed-pool-backlog.ts [--budget 2000]

const BUDGET = parseBound(process.argv.slice(2), 2_000);
const names = await backlogNames(BUDGET);
console.log(`backlog: ${names.length} names within budget ${BUDGET}`);
const report = await runNameProbes(names, BUDGET);
console.log(`probed ${report.checked}, boards found ${report.found}`);
const left = (await backlogNames(1)).length;
console.log(left ? "backlog remains — rerun to continue." : "backlog fully drained.");
await prisma.$disconnect();
