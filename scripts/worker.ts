import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { appendFileSync } from "node:fs";
import { prisma } from "../src/lib/db";
import { staleVectorWhere } from "../src/lib/embed";
import { FIT_PROMPT_VERSION, judgeableWhere, VISA_MARKED } from "../src/lib/fit";
import { chunkFromHistogram, chunkLabel, chunkWhere, type Chunk } from "../src/lib/chunks";
import { acquireGpu, beatGpu, gpuBusyMessage, releaseGpu } from "../src/lib/gpu-lock";

// The steady state. Everything before this was a batch you started by hand,
// which is right for a migration and wrong for a tool that lives on your
// machine — the pool changes every ingest and the work never really ends.
//
// Three rules decide the design, and each came out of a measurement.
//
// EMBEDDING LEADS, BUT ONLY FOR WHAT IS ABOUT TO BE JUDGED. A vector costs
// 0.05s against a judgment's ~50s, so the instinct is to trickle embedding in
// when nothing else runs. Backwards: the vectors decide the ORDER the ~460
// hours of judging happen in (the bake-off measured top-100 strong-match
// precision going 0.49 -> 0.61). But embedding the whole pool first is ~18
// minutes of nothing visibly happening, so each pass embeds exactly its own
// chunk — seconds — and judges it.
//
// SPONSOR-MARKED POSTINGS COME FIRST, ahead of every score chunk. The user's
// call. It is also the only visa signal available without the GPU: the
// model's reading is discovered while judging, not before, so it cannot
// prioritise anything.
//
// THE QUEUE IS NEVER MEANT TO EMPTY. Judging everything pending is ~460
// hours and grows with each ingest. The goal was never a finished pool — it
// is the best jobs, judged first, continuously. So the worker re-selects from
// the top every pass and simply gets as deep as the machine allows.
//
//   npm run worker            (runs until stopped)
//   npm run worker -- --once  (one pass, for checking behaviour)

const args = process.argv.slice(2);
const ONCE = args.includes("--once");
// How many judgments before the loop returns to re-check priorities. Each is
// ~62s (facts + judgment), so 50 means new text waits at most ~52 minutes for
// its vectors instead of the ~3.4 hours a 200-job batch would impose. The
// cost of returning is one queue rebuild, which fit-fill does every 100
// analyses anyway.
const BATCH = Number(args[args.indexOf("--batch") + 1]) || 50;
const IDLE_MS = 60_000;

function log(line: string): void {
  const stamped = `[${new Date().toISOString().slice(0, 19)}] ${line}`;
  console.log(stamped);
  appendFileSync("worker.log", stamped + "\n");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ESM has no require.resolve, and npm/npx would add a shell layer that makes
// the child harder to kill cleanly on Windows. Point node at tsx directly.
const TSX = fileURLToPath(import.meta.resolve("tsx/cli"));

// Run one of the existing scripts as a child. They stay independently
// runnable — the worker composes the tools rather than reimplementing them,
// so there is one embed-fill, not two that can drift apart.
function run(script: string, extra: string[] = []): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [TSX, "--env-file=.env", script, ...extra],
      {
        stdio: ["ignore", "inherit", "inherit"],
        // The child runs under OUR lock; it must not refuse itself, and it
        // must not release a lock it does not own when it exits.
        env: { ...process.env, JOBRADAR_GPU_DELEGATED: "1" },
      },
    );
    const beat = setInterval(beatGpu, 20_000);
    child.on("exit", (code) => { clearInterval(beat); resolve(code ?? 1); });
  });
}

const CANDIDATE = { disqualified: false, delistedAt: null, duplicateOfId: null } as const;

// The same rows the child will work on — used for the before/after progress
// check, so "did that do anything" is asked about the right population.
function laneWhere(lane: Lane) {
  const q = judgeableWhere(true) as any;
  return lane.kind === "visa"
    ? { ...q, AND: [...(q.AND ?? []), VISA_MARKED] }
    : { ...q, ...chunkWhere(lane.chunk) };
}

// What the worker works on next, in one place.
//
// Sponsor-marked postings are the OUTER priority, not a tie-break inside a
// score chunk. That is the user's call and it is cheap: 2,828 of them against
// 24,271 others, about two days of judging before the general queue starts.
// They are also the only visa signal available without the GPU — the model's
// reading of a posting is discovered while judging it, not before.
//
// Everything else descends by score in chunks of roughly CHUNK_TARGET,
// re-selected from the top on every pass, so a high-scoring posting arriving
// mid-descent is picked up next turn rather than in two days.
type Lane =
  | { kind: "visa"; n: number }
  | { kind: "chunk"; chunk: Chunk };

async function nextLane(): Promise<Lane | null> {
  const q = judgeableWhere(true) as any;
  const visa = await prisma.job.count({ where: { ...q, AND: [...(q.AND ?? []), VISA_MARKED] } });
  if (visa > 0) return { kind: "visa", n: visa };
  // The pending histogram, straight from SQL: 27k rows is too many to pull
  // into memory just to group them.
  const hist: Array<{ score: number; n: bigint }> = await prisma.$queryRawUnsafe(
    `SELECT score, COUNT(*) n FROM Job
     WHERE disqualified = 0 AND delistedAt IS NULL AND duplicateOfId IS NULL
       AND status IN ('new','interested') AND score >= 40
       AND (fitScore IS NULL OR fitPromptVersion IS NOT ?)
     GROUP BY score`,
    FIT_PROMPT_VERSION,
  );
  const chunk = chunkFromHistogram(hist.map((h) => ({ score: h.score, n: Number(h.n) })));
  return chunk ? { kind: "chunk", chunk } : null;
}

async function pass(): Promise<boolean> {
  const busy = gpuBusyMessage();
  if (busy) { log(busy); return false; }

  const lane = await nextLane();
  if (lane) {
    // Scope both stages to the SAME selection: vectors for exactly what we
    // are about to judge, which is seconds of work, not the twenty minutes a
    // whole-pool embed would cost before the first verdict.
    const args = lane.kind === "visa"
      ? ["--visa-marked"]
      : ["--min-score", String(lane.chunk.lo), "--max-score", String(lane.chunk.hi)];
    const label = lane.kind === "visa"
      ? `vize işaretli (${lane.n.toLocaleString("tr")})`
      : `${chunkLabel(lane.chunk)} (${lane.chunk.n.toLocaleString("tr")})`;

    const before = await prisma.job.count({ where: laneWhere(lane) });

    if (!acquireGpu("worker/embed")) return false;
    try {
      const lw = laneWhere(lane) as any;
      const stale = await prisma.job.count({
        // Same trap: laneWhere already carries an AND list, and
        // staleVectorWhere returns an OR — merge, never spread over.
        where: { ...lw, AND: [...(lw.AND ?? []), staleVectorWhere()] },
      });
      if (stale > 0) {
        log(`${label} — ${stale.toLocaleString("tr")} vektör eksik/bayat, önce onlar`);
        await run("scripts/embed-fill.ts", ["--candidates", ...args]);
      }
    } finally { releaseGpu(); }

    if (!acquireGpu("worker/judge")) return false;
    log(`${label} — ${BATCH} ilan yargılanıyor`);
    try {
      await run("scripts/fit-fill.ts", ["--wide", "--limit", String(BATCH), ...args]);
    } finally { releaseGpu(); }

    // Did anything actually happen? A child that exits without judging —
    // because every row was skipped, or a predicate drifted apart from this
    // count — would otherwise be respawned forever. Belt and braces on top of
    // sharing judgeableWhere: this catches the NEXT such mismatch too.
    const after = await prisma.job.count({ where: laneWhere(lane) });
    if (after >= before) {
      log(`  ilerleme yok (${after} hâlâ sırada) — bekleniyor`);
      return false;
    }
    return true;
  }

  // Nothing live to do: spend the idle GPU on the archive's vectors. A
  // scorer fix can requalify those rows, and the rescue lane mines them by
  // similarity — but they must never delay live work, so they run last.
  const archive = await prisma.job.count({
    where: { disqualified: true, delistedAt: null, duplicateOfId: null, ...staleVectorWhere() },
  });
  if (archive > 0) {
    if (!acquireGpu("worker/archive")) return false;
    log(`boşta: arşivde ${archive.toLocaleString("tr")} vektör eksik — sırayı tıkamadan dolduruluyor`);
    try { await run("scripts/embed-fill.ts", ["--budget", "2000"]); } finally { releaseGpu(); }
    return true;
  }

  log(`kuyruk boş (prompt ${FIT_PROMPT_VERSION}) — ${IDLE_MS / 1000} sn bekleniyor`);
  return false;
}

async function main() {
  log(`=== worker başladı (pid ${process.pid}) ===`);
  const stop = () => { releaseGpu(); log("=== worker durdu ==="); process.exit(0); };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  for (;;) {
    const did = await pass();
    if (ONCE) break;
    if (!did) await sleep(IDLE_MS);
  }
  releaseGpu();
  await prisma.$disconnect();
}

main().catch((e) => { releaseGpu(); console.error(e); process.exit(1); });
