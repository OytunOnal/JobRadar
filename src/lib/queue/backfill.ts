// THE RUN AROUND THE LOOP.
//
// Ten scripts under scripts/ carry a byte-identical `log()` — hashed, not
// eyeballed: same template, same `.slice(0, 19)`, same trailing newline, ten
// times. Three carry a byte-identical eight-line GPU preamble. Four hand-write
// a fail-streak with four different trip actions. Every one hand-writes its own
// `--budget` parsing, in four idioms with three different defaults for
// "unbounded". None of them returns anything a caller can read.
//
// What is NOT the same is the loop, and this module deliberately does not touch
// it. embed-fill's hill-climbing batch sizer, fit-fill's re-snapshotting queue,
// desc-fill's per-platform circuit breaker — those are what make those scripts
// worth having. Flattening three real algorithms into one runner shape would be
// the shallow-module mistake in reverse: a narrow interface bought by throwing
// away depth.
//
// So: the caller keeps the loop, and hands it to `backfill`, which owns
// everything around it.
//
// THE FAIL-STREAK AND THE STALL CHECK ARE A MATCHED PAIR, and adding either
// alone is worse than adding neither. The census that prompted this module
// found a clean split: every script that talks to an LLM tolerates a bad row,
// and every script that only talks to the database does not — while the
// database-only ones are precisely the ones running unattended over hundreds of
// thousands of rows. rescore, visa-retier and locations-fill have no try/catch,
// no main() and no .catch(), so one bad row kills the process mid-batch with no
// footer, no disconnect and no record of where it stopped.
//
// The tempting fix is row tolerance. On its own it would be a disaster:
// rescore pages with `take: 2000` and NO cursor, relying on each write to
// consume its own row from the predicate. Swallow the error and the same
// poisoned rows come back forever, printing progress, at full speed. That is
// why `round()` exists — it is the worker's before/after progress check,
// brought inside the process.

import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "../db";
import { acquireGpu, beatGpu, delegatedUnder, gpuBusyMessage, gpuHolder, releaseGpu, releaseGpuChild } from "./gpu-lock";

export type StopReason = "drained" | "budget" | "stalled" | "failstreak" | "gpu-busy" | "error";

export interface RunResult {
  script: string;
  done: number;
  skipped: number;
  failed: number;
  stopped: StopReason;
  error?: string;
  startedAt: string;
  endedAt: string;
}

export interface BackfillOptions {
  /** Default bound; `--budget N` or `--limit N` overrides it. */
  budget?: number;
  /** Holder label for the GPU lock. Omit for scripts that do not use the GPU. */
  gpu?: string;
  /** Consecutive failures before giving up. */
  failStreak?: number;
  /** Rounds that make no progress before giving up. */
  stallRounds?: number;
}

export interface Run {
  /** Stamped to stdout and to <script>.log, exactly as all ten copies did. */
  log(line: string): void;
  /** One unit of work landed. Resets the fail streak. */
  did(n?: number): void;
  /** Deliberately not done — a row that did not qualify. Not a failure. */
  skip(n?: number): void;
  /** A row threw. Three in a row and the run gives up. */
  failed(e?: unknown): void;
  /**
   * Call once per OUTER round — a page, a batch, a re-snapshot. False means
   * stop: budget spent, or several rounds in a row made no progress at all.
   *
   * Not per row. `round()` drives the stall check by comparing progress
   * between calls, so calling it per row would read a single skipped row as a
   * stalled round and give up after three of them.
   */
  round(): boolean;
  /** Per-row budget check, so `--budget 1` means one row and not one page. */
  exhausted(): boolean;
  /** The queue is empty — the good ending. */
  drained(): void;
  readonly done: number;
}

function receiptPath(script: string): string {
  return join(".run", `${script}.json`);
}

// The name a spawned script will file its receipt under.
//
// A script is spawned by PATH and files its receipt by NAME, and those two
// have to agree. They stopped agreeing the moment the scripts moved into
// subdirectories: the worker was stripping only a leading "scripts/", so it
// looked for `.run/backfill/embed-fill.json` while the child wrote
// `.run/embed-fill.json`. Every receipt read came back null, every pass
// reported no progress, and the backoff ladder climbed to its 30-minute rung
// and stayed there — the exact stall this whole channel exists to prevent,
// reintroduced by a directory rename.
//
// It lives here, next to the writer, so one test can hold both halves.
// `[^.]` and not `[a-z]`: an extension with a digit in it (.ps1, .mjs is fine,
// .ts is fine) would otherwise survive the strip and end up inside the receipt
// name. Only .ts scripts go through here today, so this is the cheap kind of
// correctness — nothing is broken, and the next caller will not have to find
// out that the general-sounding helper was only ever general for letters.
export function runNameFor(scriptPath: string): string {
  return scriptPath.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "");
}

// Clear a script's receipt before spawning it, so what is read afterwards can
// only be THIS run's. Without it, a child that never reached its finish — the
// 0xC0000142 case, where the process could not start at all — leaves the
// previous run's receipt in place and the parent reads it as today's answer.
export function clearRun(script: string): void {
  try { rmSync(receiptPath(script)); } catch { /* nothing to clear */ }
}

// What a child actually did. `null` means it never got to finish(), which is
// itself the answer: the run died somewhere the runner could not report from.
export function readRun(script: string): RunResult | null {
  try {
    return JSON.parse(readFileSync(receiptPath(script), "utf8")) as RunResult;
  } catch {
    return null;
  }
}

function parseBound(argv: readonly string[], fallback: number): number {
  for (const flag of ["--budget", "--limit"]) {
    const i = argv.indexOf(flag);
    // indexOf returns -1 when absent, and -1 + 1 is 0 — without this guard a
    // leading positional argument silently becomes the bound. Five of the six
    // hand-written copies of this parser had that bug.
    if (i !== -1) {
      const n = Number(argv[i + 1]);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return fallback;
}

class Sentinel extends Error {
  constructor(readonly reason: StopReason) { super(reason); }
}

export async function backfill(
  script: string,
  opts: BackfillOptions,
  body: (run: Run) => Promise<void>,
): Promise<RunResult> {
  const startedAt = new Date().toISOString();
  const budget = parseBound(process.argv.slice(2), opts.budget ?? Number.MAX_SAFE_INTEGER);
  const maxFail = opts.failStreak ?? 3;
  const maxStall = opts.stallRounds ?? 3;

  let done = 0, skipped = 0, failed = 0, failStreak = 0;
  let stopped: StopReason = "drained";
  let error: string | undefined;
  let lastRoundDone = -1, stallRounds = 0;

  const log = (line: string): void => {
    const stamped = `[${new Date().toISOString().slice(0, 19)}] ${line}`;
    console.log(stamped);
    appendFileSync(`${script}.log`, stamped + "\n");
  };

  const finish = async (): Promise<RunResult> => {
    const result: RunResult = {
      script, done, skipped, failed, stopped, error,
      startedAt, endedAt: new Date().toISOString(),
    };
    // The child→parent channel. The worker's only signal today is an exit code
    // in which "finished the work" and "gave up immediately" are both 0, so it
    // re-queries the database to guess which happened — and the PowerShell
    // composer resorts to tailing the log file for a Turkish word.
    try {
      mkdirSync(".run", { recursive: true });
      writeFileSync(receiptPath(script), JSON.stringify(result, null, 2));
    } catch {
      // A run that cannot write its receipt still did the work. Never let the
      // bookkeeping fail the job.
    }
    log(`=== Bitti: ${done} işlendi${skipped ? `, ${skipped} atlandı` : ""}${failed ? `, ${failed} hata` : ""} (${stopped}) ===`);
    await prisma.$disconnect();
    return result;
  };

  // Refuse rather than compete: two processes alternating between the 27B and
  // the embedder spend their time reloading 17.7 GB of weights, not working.
  //
  // THREE WAYS THIS RUN CAN RELATE TO THE GPU, and the run has to know which.
  //
  // Under the worker, JOBRADAR_GPU_DELEGATED carries the parent's pid: the
  // lock is already held on our behalf, so we neither acquire nor release it.
  // We DO beat, and the beat is also how we say who we are — the parent cannot
  // name us, because it spawns `node tsx/cli <script>` and tsx re-spawns, so
  // the only pid it can see belongs to a wrapper that loads no model.
  //
  // But delegation is a claim to be checked, not taken. If the lock is gone or
  // stale, or belongs to some other worker entirely, then we are not under it
  // and must take our own — otherwise a four-hour judging pass runs with no
  // protection while every comment here says otherwise.
  //
  // And if we cannot take one, we do not run. Believing you hold the card is
  // worse than knowing you do not.
  let heartbeat: NodeJS.Timeout | undefined;
  if (opts.gpu) {
    const busy = gpuBusyMessage();
    if (busy) {
      log(busy);
      stopped = "gpu-busy";
      return finish();
    }
    const under = delegatedUnder(gpuHolder());
    if (process.env.JOBRADAR_GPU_DELEGATED && !under) {
      log("Üst sürecin GPU kilidi yok ya da başkasına ait — kilidi bu koşu alıyor.");
    }
    if (under) {
      // The beat is also the claim, so the first one says who we are.
      beatGpu();
      process.on("exit", releaseGpuChild);
    } else if (acquireGpu(opts.gpu)) {
      process.on("exit", releaseGpu);
    } else if (gpuHolder()) {
      // Lost a race that gpuBusyMessage() won a moment ago. Ordinary
      // contention, and it must not be filed as a crash: `error` is the
      // receipt reason that means something is genuinely broken, and the
      // worker's ladder reads the two differently.
      log(gpuBusyMessage() ?? "GPU başkasında.");
      stopped = "gpu-busy";
      return finish();
    } else {
      log("GPU kilidi yazılamadı — koşulmuyor, çünkü tuttuğunu sanmak tutmamaktan kötü.");
      stopped = "error";
      error = "GPU kilidi yazılamadı";
      return finish();
    }
    heartbeat = setInterval(beatGpu, 20_000);
    heartbeat.unref();
  }

  const run: Run = {
    log,
    did(n = 1) { done += n; failStreak = 0; },
    skip(n = 1) { skipped += n; },
    failed(e?: unknown) {
      failed++;
      failStreak++;
      if (e) log(`  hata: ${String((e as Error)?.message ?? e).slice(0, 140)}`);
      if (failStreak >= maxFail) throw new Sentinel("failstreak");
    },
    exhausted() {
      if (done < budget) return false;
      stopped = "budget";
      return true;
    },
    round() {
      if (done >= budget) { stopped = "budget"; return false; }
      // No progress since the last round. A cursor-less pager re-fetching the
      // same rows looks exactly like this, and would otherwise run forever.
      if (done === lastRoundDone) {
        if (++stallRounds >= maxStall) { stopped = "stalled"; return false; }
      } else {
        stallRounds = 0;
        lastRoundDone = done;
      }
      return true;
    },
    drained() { stopped = "drained"; },
    get done() { return done; },
  };

  try {
    await body(run);
  } catch (e) {
    if (e instanceof Sentinel) {
      stopped = e.reason;
      log(`Üst üste ${maxFail} hata — ${done} işlemle duruldu.`);
    } else {
      stopped = "error";
      error = String((e as Error)?.message ?? e).slice(0, 300);
      log(`ÇÖKTÜ: ${error}`);
    }
  } finally {
    if (heartbeat) clearInterval(heartbeat);
  }

  return finish();
}
