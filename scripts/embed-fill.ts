import { appendFileSync } from "node:fs";
import { prisma } from "../src/lib/db";
import { acquireGpu, beatGpu, gpuBusyMessage, releaseGpu } from "../src/lib/gpu-lock";
import { embedTexts, jobEmbedText, toBuffer, EMBED_MODEL, embedStamp, staleVectorWhere } from "../src/lib/embed";
import { chunkFromArgs, chunkWhere } from "../src/lib/chunks";
import { andWhere, archiveWhere, openWhere } from "../src/lib/pool";
import { judgeTargetWhere } from "../src/lib/fit";
import { VISA_MARKED } from "../src/lib/visa";

// Embedding backfill: vectors for every job that doesn't have one. Local
// (Ollama), no API cost. Candidates first, disqualified rows after them (the
// rescue lane wants those too). Resumable by nature — the null check IS the
// queue.
//
// Optimized as a 3-stage producer/consumer pipeline so the GPU never idles:
//   fetch(next batch)  ||  embed(current batch on GPU)  ||  write(previous)
// plus batched writes (one INSERT..ON CONFLICT per batch instead of N
// round-trips) and a bigger batch (128 — the 0.6B model has VRAM to spare).
// Measured before: ~16 jobs/s sequential; the pipeline overlaps the DB time
// that used to leave the GPU waiting.
//
//   npm run embed:fill                (whole backlog)
//   npm run embed:fill -- --budget 5000

const args = process.argv.slice(2);
const bIdx = args.indexOf("--budget");
const BUDGET = bIdx !== -1 ? Number(args[bIdx + 1]) || 1_000_000 : 1_000_000;
// --open: stop after the open pool instead of walking into the disqualified
// archive. The archive is worth embedding (a scorer fix can revive it, and the
// rescue lane mines it by similarity) but it is 445k rows of work that must not
// stand between a text change and the judging queue.
const OPEN_ONLY = args.includes("--open");
// --archive: the mirror image — ONLY the disqualified archive. Without it the
// worker's idle lane said "filling the archive" while embed-fill walked the
// live pool first, so the archive was never reached as long as one
// non-judgeable posting was stale, and the log said otherwise.
const ARCHIVE_ONLY = args.includes("--archive");
// --judge-target: restrict to where the judge's time actually goes. The worker
// passes it so the rows this embeds are the rows it is about to judge; without
// it a lane spent GPU vectorising postings no judging pass would ever read.
const JUDGE_TARGET = args.includes("--judge-target");
// --min-score / --max-score: embed one score chunk. The worker walks chunks
// top-down and wants vectors for the chunk it is about to judge, not for the
// whole pool — seconds of work instead of a quarter of an hour.
const CHUNK = chunkFromArgs(args);
// --visa-marked: embed only the sponsor-marked lane, so the worker's first
// pass vectorises 2,373 postings instead of the whole 74k pool before it can
// judge the ones the user asked for first.
const VISA_ONLY = args.includes("--visa-marked");
// Frozen once. judgeTargetWhere carries a 45-day cut-off, and a run that
// recomputed it per query would be walking a population that moves underneath
// it — the same hazard that made the worker's progress check unreliable.
const NOW = new Date();

// THE POPULATION THIS RUN WALKS — one definition, used by the header count and
// by the walker.
//
// They used to be written separately, twelve lines apart, and they disagreed:
// the count left `disqualified` unconstrained while the walker pinned it per
// phase, so a plain `npm run embed:fill` announced a queue it was not walking.
// Same class of bug as everything pool.ts exists to prevent, in the file that
// imports the most predicates.
function populationWhere(phase: 0 | 1) {
  return andWhere(
    phase === 1 ? archiveWhere() : openWhere(),
    JUDGE_TARGET ? judgeTargetWhere(true, NOW) : null,
    chunkWhere(CHUNK),
    VISA_ONLY ? VISA_MARKED : null,
    // "Missing" is not the only kind of stale. A vector built from text we have
    // since re-fetched, or from a projection we have since redesigned, is wrong
    // in a way `vector IS NULL` cannot express — which is how the pool once
    // reported zero pending work while every vector was outdated.
    staleVectorWhere(),
  );
}

// Adaptive batch size: the ideal depends on GPU state we can't see (VRAM
// occupancy, partial offload, background load) and it CHANGES mid-run —
// measured 30/s and 5/s with the same constants on the same machine. A
// hill-climber measures real jobs/sec per window and walks the ladder;
// a periodic re-probe escapes stale optima when conditions shift.
// 512 killed the run live: one /api/embed call with 512 texts (~200k tok)
// gets rejected by the server. 256 is the measured safe ceiling.
const LADDER = [32, 64, 128, 256];
let ladderIdx = 2; // start at 128
let BATCH = LADDER[ladderIdx];
let direction = 1;
const WINDOW = 6; // batches per measurement window
let windowJobs = 0;
let windowStart = Date.now();
let windowBatches = 0;
let lastRate = 0;
let sinceProbe = 0;
function tuneAfterBatch(n: number): void {
  windowJobs += n;
  windowBatches++;
  if (windowBatches < WINDOW) return;
  const rate = windowJobs / ((Date.now() - windowStart) / 1000);
  const prev = lastRate;
  lastRate = rate;
  windowJobs = 0; windowBatches = 0; windowStart = Date.now();
  sinceProbe++;
  if (prev === 0) return; // first window: baseline only
  if (rate > prev * 1.05) {
    // improving — keep walking the same direction
    const next = ladderIdx + direction;
    if (next >= 0 && next < LADDER.length) { ladderIdx = next; BATCH = LADDER[ladderIdx]; log(`  [tune] ${rate.toFixed(0)}/sn ↑ — batch → ${BATCH}`); }
  } else if (rate < prev * 0.9) {
    // got worse — reverse and step back
    direction = -direction;
    const next = ladderIdx + direction;
    if (next >= 0 && next < LADDER.length) { ladderIdx = next; BATCH = LADDER[ladderIdx]; log(`  [tune] ${rate.toFixed(0)}/sn ↓ — batch → ${BATCH}`); }
  } else if (sinceProbe >= 10) {
    // stable for ~10 windows: re-probe a neighbor in case conditions changed
    sinceProbe = 0;
    const next = ladderIdx + direction;
    if (next >= 0 && next < LADDER.length) { ladderIdx = next; BATCH = LADDER[ladderIdx]; log(`  [tune] yeniden yoklama — batch → ${BATCH}`); }
  }
}

function log(line: string): void {
  const stamped = `[${new Date().toISOString().slice(0, 19)}] ${line}`;
  console.log(stamped);
  appendFileSync("embed-fill.log", stamped + "\n");
}

interface Row { id: string; title: string; content: { description: string; textVersion: string | null } | null }

// One multi-row statement per batch — SQLite pays the commit cost once, not
// N times. $executeRawUnsafe with placeholders (values parameterized).
async function writeBatch(rows: Row[], vecs: number[][]): Promise<void> {
  const placeholders = rows.map(() => "(?, ?, ?, ?)").join(", ");
  const params: unknown[] = [];
  for (let i = 0; i < rows.length; i++) {
    // The stamp says which PROJECTION built this vector. Whether the text has
    // since changed is answered by the writer clearing it, not by comparing
    // version strings here.
    params.push(rows[i].id, EMBED_MODEL, Buffer.from(toBuffer(vecs[i])), embedStamp());
  }
  await prisma.$executeRawUnsafe(
    `INSERT INTO JobEmbedding (jobId, model, vector, builtFrom) VALUES ${placeholders}
     ON CONFLICT(jobId) DO UPDATE SET model = excluded.model, vector = excluded.vector,
       builtFrom = excluded.builtFrom`,
    ...params,
  );
}

// Refuse rather than compete: two processes alternating between the 27B and
// the embedder spend their time reloading 17.7 GB of weights, not working.
{
  const busy = gpuBusyMessage();
  if (busy) { log(busy); await prisma.$disconnect(); process.exit(0); }
  if (process.env.JOBRADAR_GPU_DELEGATED !== "1") acquireGpu("manual/embed");
  if (process.env.JOBRADAR_GPU_DELEGATED !== "1") process.on("exit", releaseGpu);
  setInterval(beatGpu, 20_000).unref();
}

async function main() {
  // Counted over exactly the population the run will walk, phase by phase: a
  // header that promises 520k and stops at 78k reads like a crash.
  const total = ARCHIVE_ONLY
    ? await prisma.job.count({ where: populationWhere(1) })
    : OPEN_ONLY
      ? await prisma.job.count({ where: populationWhere(0) })
      : (await prisma.job.count({ where: populationWhere(0) })) +
        (await prisma.job.count({ where: populationWhere(1) }));
  log(`=== embed:fill (${EMBED_MODEL}, pipelined) — kuyrukta ${total} ilan ===`);

  let done = 0;
  let lastLogged = 0;
  const t0 = Date.now();
  let pendingWrite: Promise<void> = Promise.resolve();
  // Prefetch the first batch; inside the loop the NEXT fetch runs while the
  // GPU embeds the current one, and the write of the current overlaps the
  // next embed. The fetch's `vector: null` queue is self-advancing only after
  // the write lands, so the prefetch may overlap one in-flight batch — the
  // ON CONFLICT upsert makes any overlap harmless.
  // Two embed calls in flight: Ollama can process them in parallel server-side
  // (OLLAMA_NUM_PARALLEL), and even when it can't, the second request's
  // tokenization/transfer overlaps the first's compute. Cursor-paged fetches
  // (id > lastId among vectorless rows) keep the two in-flight batches from
  // ever being the same rows, independent of write timing.
  // Two phases keep the "open pool first" priority: phase 0 walks the open
  // pool, phase 1 the archive. Within a phase, id-cursor pages.
  let lastId = "";
  // --archive starts at the archive phase and never touches the open pool;
  // --open does the reverse. Both are needed: the worker's idle lane must be
  // able to say "only the archive" and mean it.
  let phase: 0 | 1 = ARCHIVE_ONLY ? 1 : 0;
  const fetchAfter = async (): Promise<Row[]> => {
    for (;;) {
      const rows = await prisma.job.findMany({
        where: andWhere(populationWhere(phase), { id: { gt: lastId } }),
        orderBy: { id: "asc" },
        take: BATCH,
        select: { id: true, title: true, content: { select: { description: true, textVersion: true } } },
      });
      if (rows.length > 0) {
        lastId = rows[rows.length - 1].id;
        return rows;
      }
      if (phase === 1 || OPEN_ONLY) return [];
      phase = 1;
      lastId = "";
    }
  };

  let a = await fetchAfter();
  let b = await fetchAfter();
  let embedA: Promise<number[][] | Error> | null = a.length ? embedTexts(a.map((j) => jobEmbedText(j.title, j.content?.description ?? null))).catch((e) => e as Error) : null;
  while (done < BUDGET && embedA) {
    const embedB = b.length ? embedTexts(b.map((j) => jobEmbedText(j.title, j.content?.description ?? null))).catch((e) => e as Error) : null;
    let vecs = await embedA;
    if (vecs instanceof Error) {
      // Server refused/failed the batch: retreat down the ladder and redo
      // THIS batch in safe chunks instead of dying mid-run.
      log(`  [tune] embed hatası (${vecs.message.slice(0, 60)}) — batch küçültülüp yeniden denenecek`);
      ladderIdx = Math.max(0, ladderIdx - 1);
      BATCH = LADDER[ladderIdx];
      direction = -1;
      const redo: number[][] = [];
      for (let i = 0; i < a.length; i += 64) {
        redo.push(...(await embedTexts(a.slice(i, i + 64).map((j) => jobEmbedText(j.title, j.content?.description ?? null)))));
      }
      vecs = redo;
    }
    await pendingWrite;
    pendingWrite = writeBatch(a, vecs);
    done += a.length;
    tuneAfterBatch(a.length);
    if (done - lastLogged >= 1500) {
      lastLogged = done;
      const rate = done / ((Date.now() - t0) / 1000);
      log(`  ${done}/${Math.min(total, BUDGET)} embed edildi (ort ${rate.toFixed(0)}/sn, batch ${BATCH})`);
    }
    a = b;
    embedA = embedB;
    b = await fetchAfter();
  }
  await pendingWrite;
  log(`=== Bitti: ${done} ilan embed edildi (${(done / ((Date.now() - t0) / 1000)).toFixed(0)}/sn ort) ===`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
