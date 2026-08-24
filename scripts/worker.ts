import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { appendFileSync } from "node:fs";
import { prisma } from "../src/lib/db";
import { staleVectorWhere } from "../src/lib/embed";
import { andWhere, FIT_PROMPT_VERSION, judgeableWhere, VISA_MARKED } from "../src/lib/fit";
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
// How many judgments before the loop returns to re-check priorities.
//
// 50 was chosen for preemption latency and turned out to be the wrong axis to
// optimise on THIS machine. The GPU holds 6 GB and the model needs 17.7, so
// llama-server keeps ~15.5 GB of system RAM resident; with a dev server and a
// browser running, that leaves about 5 GB. Spawning a fresh node+tsx (Prisma,
// esbuild, ~400 MB) into that gap failed with 0xC0000142 — DLL init under
// memory pressure — and every spawn is another chance to hit it.
//
// So spawn rarely: 250 judgments is roughly four hours of work per process.
// Nothing is lost by it, because fit-fill rebuilds its own queue every 100
// analyses; what the worker adds on return is the lane decision, and a lane
// currently lasts ~50 hours.
const batchIdx = args.indexOf("--batch");
// indexOf returns -1 when the flag is absent, and -1 + 1 is 0 — so without
// this guard a leading positional argument silently became the batch size.
const BATCH = (batchIdx !== -1 ? Number(args[batchIdx + 1]) : NaN) || 250;
const IDLE_MS = 60_000;
// A child that cannot even start is not a transient hiccup to retry a minute
// later — the machine is out of room, and hammering it every 60s neither
// helps nor lets the pressure clear. Back off instead. (It cost us real work:
// the retry loop held the GPU idle long enough for Ollama to unload the 27B,
// so the next successful batch had to pay the 17.7 GB reload.)
const BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000, 30 * 60_000];
let failStreak = 0;

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
    // Without this the emitted error is unhandled and takes down the one
    // process built to survive its children failing.
    child.on("error", (e) => {
      clearInterval(beat);
      log(`  süreç başlatılamadı: ${e.message}`);
      resolve(1);
    });
  });
}

const CANDIDATE = { disqualified: false, delistedAt: null, duplicateOfId: null } as const;

// The same rows the child will work on — used for the before/after progress
// check, so "did that do anything" is asked about the right population.
function laneWhere(lane: Lane) {
  return lane.kind === "visa"
    ? andWhere(judgeableWhere(true), VISA_MARKED)
    : andWhere(judgeableWhere(true), chunkWhere(lane.chunk));
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
  const visa = await prisma.job.count({ where: andWhere(judgeableWhere(true), VISA_MARKED) });
  if (visa > 0) return { kind: "visa", n: visa };
  // groupBy on judgeableWhere, NOT a hand-written SQL copy of it.
  //
  // The copy left out freshness-or-sponsor-marked and the country/remote test,
  // so it counted 71,968 pending where 26,417 were actually judgeable. That is
  // not merely a wrong number in a log line: the chunk it picked claimed 4,201
  // rows at score 100 while only 1,929 could be judged, and once those were
  // done the histogram still reported the rest. chunkFromHistogram would hand
  // back the same {100,100} chunk forever, before === after would report "no
  // progress", and the worker would back off to 30 minutes and never descend
  // to score 99 — a permanent stall, roughly 33 hours from now.
  const hist = await prisma.job.groupBy({
    by: ["score"],
    _count: { _all: true },
    where: judgeableWhere(true),
  });
  const chunk = chunkFromHistogram(hist.map((h) => ({ score: h.score, n: h._count._all })));
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
    const childArgs = lane.kind === "visa"
      ? ["--visa-marked"]
      : ["--min-score", String(lane.chunk.lo), "--max-score", String(lane.chunk.hi)];
    const label = lane.kind === "visa"
      ? `vize işaretli (${lane.n.toLocaleString("tr")})`
      : `${chunkLabel(lane.chunk)} (${lane.chunk.n.toLocaleString("tr")})`;

    const before = await prisma.job.count({ where: laneWhere(lane) });

    // ONE acquire for the whole lane. Releasing between embedding and judging
    // let a manual script slip into the gap and start swapping models against
    // us — the exact thrash the lock exists to prevent.
    if (!acquireGpu("worker/lane")) return false;
    try {
      const stale = await prisma.job.count({
        where: andWhere(laneWhere(lane), staleVectorWhere()),
      });
      if (stale > 0) {
        log(`${label} — ${stale.toLocaleString("tr")} vektör eksik/bayat, önce onlar`);
        const code = await run("scripts/embed-fill.ts", ["--candidates", ...childArgs]);
        // A crashed embed pass must not be followed by judging on the stale
        // vectors it failed to replace: that is a whole batch ordered by a
        // queue we know is wrong, and nothing would say so.
        if (code !== 0) {
          log(`  embed:fill çıkış kodu ${code} — bu turda yargılamayı atlıyorum`);
          return false;
        }
      }

      log(`${label} — ${BATCH} ilan yargılanıyor`);
      const code = await run("scripts/fit-fill.ts", ["--wide", "--limit", String(BATCH), ...childArgs]);
      if (code !== 0) log(`  fit:fill çıkış kodu ${code}${code === 3221225794 ? " (0xC0000142 — süreç başlayamadı, bellek dar)" : ""}`);
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
    where: andWhere(
      { disqualified: true, delistedAt: null, duplicateOfId: null },
      staleVectorWhere(),
    ),
  });
  if (archive > 0) {
    if (!acquireGpu("worker/archive")) return false;
    log(`boşta: arşivde ${archive.toLocaleString("tr")} vektör eksik — sırayı tıkamadan dolduruluyor`);
    try {
      // --archive, or embed-fill walks the live pool first and this message
      // describes work it is not doing.
      const code = await run("scripts/embed-fill.ts", ["--archive", "--budget", "2000"]);
      if (code !== 0) {
        // Returning true here reset failStreak and skipped the whole backoff
        // ladder, so a child that could not start was respawned immediately —
        // exactly the tight loop the ladder exists to prevent.
        log(`  embed:fill (arşiv) çıkış kodu ${code}`);
        return false;
      }
    } finally { releaseGpu(); }
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
    if (did) {
      failStreak = 0;
      continue;
    }
    const wait = BACKOFF_MS[Math.min(failStreak, BACKOFF_MS.length - 1)];
    failStreak++;
    if (failStreak > 1) log(`  ${Math.round(wait / 60000)} dk bekleniyor (${failStreak}. boş tur)`);
    await sleep(wait);
  }
  releaseGpu();
  await prisma.$disconnect();
}

main().catch((e) => { releaseGpu(); console.error(e); process.exit(1); });
