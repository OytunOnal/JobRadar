import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { appendFileSync } from "node:fs";
import { prisma } from "../src/lib/db";
import { staleVectorWhere } from "../src/lib/embed";
import { FIT_PROMPT_VERSION, judgeableWhere } from "../src/lib/fit";
import { acquireGpu, beatGpu, gpuBusyMessage, releaseGpu } from "../src/lib/gpu-lock";

// The steady state. Everything before this was a batch you started by hand,
// which is right for a migration and wrong for a tool that lives on your
// machine — the pool changes every ingest and the work never really ends.
//
// Two rules decide the whole design.
//
// FIRST, EMBEDDING IS NOT BACKGROUND WORK. It looks like the small job (a
// vector is 0.05s against a judgment's ~50s) so the instinct is to trickle it
// in when nothing else is running. That is backwards: 78k vectors is about an
// hour, and it decides the ORDER the 90+ hours of judging happen in — the
// bake-off measured strong-match precision in the top 100 going from 0.49 to
// 0.61 on the sectioned view. An hour spent making the expensive queue pick
// better jobs is the best hour in the pipeline. So embedding runs to
// completion first, always.
//
// SECOND, THE QUEUE IS NEVER MEANT TO EMPTY. Judging every candidate is 90
// hours, and extracting facts for all of them would be another 218; both
// numbers grow with every ingest. The goal was never a finished pool — it is
// the best jobs, judged first, continuously. So the worker walks the blended
// queue top-down forever and simply gets as deep as the machine allows.
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

async function pending() {
  const [vectors, judgments] = await Promise.all([
    prisma.job.count({
      where: { ...CANDIDATE, ...staleVectorWhere() },
    }),
    // The SAME predicate fit-fill queues on, not an approximation of it.
    prisma.job.count({ where: judgeableWhere(true) }),
  ]);
  return { vectors, judgments };
}

async function pass(): Promise<boolean> {
  const busy = gpuBusyMessage();
  if (busy) { log(busy); return false; }
  const { vectors, judgments } = await pending();

  if (vectors > 0) {
    if (!acquireGpu("worker/embed")) return false;
    log(`vektör: ${vectors.toLocaleString("tr")} bayat/eksik — tamamına kadar koşuyor`);
    try { await run("scripts/embed-fill.ts", ["--candidates"]); } finally { releaseGpu(); }
    return true;
  }

  if (judgments > 0) {
    if (!acquireGpu("worker/judge")) return false;
    log(`yargı: ${judgments.toLocaleString("tr")} aday sırada — ${BATCH} tanesi (gerçekler ilan başına çıkarılır)`);
    try {
      await run("scripts/fit-fill.ts", ["--wide", "--limit", String(BATCH)]);
    } finally { releaseGpu(); }
    // Did anything actually happen? A child that exits without judging
    // anything — because the queue skipped every row, or a predicate drifted
    // apart from this count — would otherwise be respawned forever. Belt and
    // braces on top of sharing judgeableWhere: this catches the NEXT such
    // mismatch too, whatever causes it.
    const left = await prisma.job.count({ where: judgeableWhere(true) });
    if (left >= judgments) {
      log(`  ilerleme yok (${left} hâlâ sırada) — kuyruk fiilen boş sayılıyor, bekleniyor`);
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
