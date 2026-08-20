import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { runIngest } from "../src/lib/ingest";
import { prisma } from "../src/lib/db";

// Full-pool board sweep: walk EVERY due board in the discovery pool (~53k
// active companies) in slices, boards-only — no aggregators, no LLM layers;
// zero token spend, pure HTTP + keyword scoring. The hitRate ledger it
// produces is the point: after one full pass every board has a measured
// relevance, and weekly ingests concentrate on the ones that hit.
//
//   npm run sweep                       (slice 1500, safety cap 100 slices)
//   npm run sweep -- --slice 1000
//
// Observability & safety:
//   - RESUMABLE: each board's lastFetchedAt persists as its slice completes;
//     rerunning continues where the rotation left off. sweep-state.json keeps
//     the running totals across restarts.
//   - RAM-AWARE: heap is sampled after every slice; above HEAP_HIGH_MB the
//     next slice halves (floor 250), back under HEAP_LOW_MB it grows back.
//   - LOGGED: every slice appends one line to sweep.log — tail it live:
//       Get-Content sweep.log -Wait -Tail 20

const args = process.argv.slice(2);
function argNum(flag: string, dflt: number): number {
  const i = args.indexOf(flag);
  const v = i !== -1 ? Number(args[i + 1]) : NaN;
  return Number.isFinite(v) && v > 0 ? v : dflt;
}
const REQUESTED_SLICE = argNum("--slice", 1500);
const MAX_SLICES = argNum("--max-slices", 100);
const HEAP_HIGH_MB = argNum("--heap-high", 1200);
const HEAP_LOW_MB = argNum("--heap-low", 500);

const STATE_PATH = "sweep-state.json";
const LOG_PATH = "sweep.log";

interface SweepState {
  startedAt: string;
  poolAtStart: number;
  slicesDone: number;
  boards: number;
  stored: number;
  updated: number;
  delisted: number;
  errors: number;
}

function loadState(): SweepState | null {
  try {
    return JSON.parse(readFileSync(STATE_PATH, "utf8"));
  } catch {
    return null;
  }
}

function log(line: string): void {
  const stamped = `[${new Date().toISOString().slice(0, 19)}] ${line}`;
  console.log(stamped);
  appendFileSync(LOG_PATH, stamped + "\n");
}

// Rough due-count for progress display: never-fetched or not touched in 24h.
// (The real isDue also honors per-board backoff intervals; this is the
// upper-bound estimate, fine for a progress bar.)
async function dueEstimate(): Promise<number> {
  const dayAgo = new Date(Date.now() - 86_400_000);
  return prisma.atsBoard.count({
    where: {
      status: "active",
      OR: [{ lastFetchedAt: null }, { lastFetchedAt: { lt: dayAgo } }],
    },
  });
}

const poolNow = await dueEstimate();
let state = loadState();
if (!state || poolNow > state.poolAtStart) {
  // Fresh sweep (or the pool grew past the recorded start — treat as fresh).
  state = {
    startedAt: new Date().toISOString(),
    poolAtStart: poolNow,
    slicesDone: 0,
    boards: 0, stored: 0, updated: 0, delisted: 0, errors: 0,
  };
}

log(`=== Board-pool sweep ${state.slicesDone > 0 ? "RESUMING" : "starting"} — ~${poolNow} boards due (pool at start: ${state.poolAtStart}) ===`);

let slice = REQUESTED_SLICE;
for (let i = 0; i < MAX_SLICES; i++) {
  const t = Date.now();
  const r = await runIngest({ boardsOnly: true, boardLimit: slice });
  const boards = Object.keys(r.perSource).filter((k) => k.startsWith("board:")).length;

  state.slicesDone++;
  state.boards += boards;
  state.stored += r.stored;
  state.updated += r.updated;
  state.delisted += r.delisted;
  state.errors += r.errors.length;
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));

  const heapMB = Math.round(process.memoryUsage().heapUsed / 1_048_576);
  const rssMB = Math.round(process.memoryUsage().rss / 1_048_576);
  const mins = ((Date.now() - t) / 60_000).toFixed(1);
  const donePct = state.poolAtStart > 0 ? Math.min(100, Math.round((state.boards / state.poolAtStart) * 100)) : 0;
  log(
    `slice ${state.slicesDone}: ${boards} boards (${mins}min) | +${r.stored} new, ${r.updated} upd, ${r.delisted} delist, ${r.errors.length} err | ` +
      `toplam ${state.boards}/${state.poolAtStart} (~%${donePct}) | heap ${heapMB}MB rss ${rssMB}MB | slice→${slice}`,
  );

  if (boards === 0) {
    log(`=== Sweep COMPLETE: ${state.boards} boards, +${state.stored} new jobs, ${state.updated} updated, ${state.delisted} delisted ===`);
    break;
  }

  // RAM-aware slice sizing for the NEXT round.
  if (heapMB > HEAP_HIGH_MB && slice > 250) {
    slice = Math.max(250, Math.floor(slice / 2));
    log(`  heap ${heapMB}MB > ${HEAP_HIGH_MB}MB — slice küçültüldü: ${slice}`);
  } else if (heapMB < HEAP_LOW_MB && slice < REQUESTED_SLICE) {
    slice = Math.min(REQUESTED_SLICE, Math.floor(slice * 1.5));
    log(`  heap rahat — slice büyütüldü: ${slice}`);
  }
}

log("Konum/dedup/fit katmanları sonraki normal ingest'lerde (bütçeli LLM) dolacak.");
await prisma.$disconnect();
