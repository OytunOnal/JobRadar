import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { runIngest } from "../../src/lib/ingest";
import { prisma } from "../../src/lib/db";

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

// The power-outage lesson: with the network down every fetch fails in
// milliseconds and the sweep rips through the pool stamping boards as
// failed attempts. Never start (or continue) a slice without connectivity.
async function waitForNetwork(): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch("https://www.google.com/generate_204", {
        signal: AbortSignal.timeout(8_000),
      });
      if (res.status < 500) return;
    } catch {
      /* unreachable */
    }
    if (attempt === 0) log("ağ erişimi yok — bağlantı gelene dek bekleniyor (60sn aralıkla)…");
    await new Promise((r) => setTimeout(r, 60_000));
  }
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
  await waitForNetwork();
  const t = Date.now();
  const r = await runIngest({ boardsOnly: true, boardLimit: slice });
  const boards = Object.keys(r.perSource).filter((k) => k.startsWith("board:")).length;

  state.slicesDone++;
  state.boards += boards;
  state.stored += r.stored;
  state.updated += r.updated;
  state.delisted += r.delisted;
  state.errors += r.sourceFailures;
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));

  const heapMB = Math.round(process.memoryUsage().heapUsed / 1_048_576);
  const rssMB = Math.round(process.memoryUsage().rss / 1_048_576);
  const mins = ((Date.now() - t) / 60_000).toFixed(1);
  const donePct = state.poolAtStart > 0 ? Math.min(100, Math.round((state.boards / state.poolAtStart) * 100)) : 0;
  log(
    `slice ${state.slicesDone}: ${boards} boards (${mins}min) | +${r.stored} new, ${r.updated} upd, ${r.delisted} delist, ${r.sourceFailures} err | ` +
      `toplam ${state.boards}/${state.poolAtStart} (~%${donePct}) | heap ${heapMB}MB rss ${rssMB}MB | slice→${slice}`,
  );

  if (r.errors.length > 0) {
    for (const e of r.errors.slice(0, 3)) log(`  hata örneği: ${e.slice(0, 110)}`);
  }
  // A near-total-failure slice means the net (or a proxy of it) died mid-run:
  // those boards were stamped wrongly — un-stamp them and wait for the net.
  //
  // Counted from the report's own number, not from how many lines its error
  // list holds: the ingest keeps a handful of examples and a total, so a
  // thousand dead boards would show up here as five.
  if (boards > 0 && r.sourceFailures >= boards * 0.9) {
    const windowStart = new Date(t - 60_000);
    const undone = await prisma.atsBoard.updateMany({
      where: { lastFetchedAt: { gte: windowStart } },
      data: { lastFetchedAt: null, fetchIntervalDays: 1, hitRate: 0 },
    });
    log(`  dilim ~tamamen hatalı — ağ kesintisi varsayıldı: ${undone.count} board geri sıfırlandı, bağlantı bekleniyor`);
    state.boards -= boards; // progress honesty: those weren't really swept
    writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
    await waitForNetwork();
  }
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
