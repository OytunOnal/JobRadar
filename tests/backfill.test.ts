import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { backfill, clearRun, readRun } from "../src/lib/backfill";
import { tuneAfterBatch } from "../scripts/embed-fill";

// Ten scripts carried a byte-identical log(). Three carried a byte-identical
// eight-line GPU preamble. Four hand-wrote a fail-streak with four different
// trip actions. None of it was executed by a single test — you could delete a
// fail-streak, invert a cursor or double-write a log and the suite stayed green.

const quiet = { budget: 1_000_000 };

test("a drained queue is the good ending, and it is recorded", async () => {
  const r = await backfill("t-drained", quiet, async (run) => {
    run.did(3);
    run.drained();
  });
  assert.equal(r.stopped, "drained");
  assert.equal(r.done, 3);
  assert.equal(r.failed, 0);
});

test("the budget bounds the run", async () => {
  const r = await backfill("t-budget", { budget: 5 }, async (run) => {
    while (run.round()) run.did();
  });
  assert.equal(r.stopped, "budget");
  assert.equal(r.done, 5);
});

// THE HALF THAT MAKES ROW TOLERANCE SAFE.
//
// rescore pages with `take: 2000` and no cursor, relying on each write to
// consume its own row from the predicate. Tolerate a bad row without this and
// the same rows come back forever, at full speed, printing progress.
test("a round that consumes nothing stops the run", async () => {
  let rounds = 0;
  const r = await backfill("t-stall", quiet, async (run) => {
    while (run.round()) {
      rounds++;
      // Simulates a poisoned page: rows keep arriving, none can be consumed.
      run.skip(2000);
      if (rounds > 50) throw new Error("the stall check did not fire");
    }
  });
  assert.equal(r.stopped, "stalled");
  assert.ok(rounds < 10, `stopped after ${rounds} rounds, not thousands`);
});

test("progress resets the stall counter, so a slow queue is not mistaken for a stuck one", async () => {
  let n = 0;
  const r = await backfill("t-slow", { budget: 6 }, async (run) => {
    while (run.round()) {
      n++;
      if (n % 3 === 0) run.did(); // two idle rounds, then progress, repeatedly
    }
  });
  assert.equal(r.stopped, "budget", "it reached the budget rather than giving up");
});

test("three failures in a row give up; a success in between does not count", async () => {
  const r = await backfill("t-fail", quiet, async (run) => {
    while (run.round()) {
      run.failed();
      run.failed();
      run.did();     // resets the streak
      run.failed();
      run.failed();
      run.failed();  // three consecutive — stops here
      throw new Error("unreachable");
    }
  });
  assert.equal(r.stopped, "failstreak");
  assert.equal(r.failed, 5);
  assert.equal(r.done, 1);
});

// The previous behaviour: a throw skipped the footer, skipped $disconnect, and
// left the worker with nothing but an exit code.
test("a crash is still a reported run, not a silent death", async () => {
  const r = await backfill("t-crash", quiet, async (run) => {
    run.did(7);
    throw new Error("the database went away");
  });
  assert.equal(r.stopped, "error");
  assert.equal(r.done, 7, "the work that landed before the crash is still reported");
  assert.ok(r.error?.includes("went away"));
});

test("every run leaves a receipt a caller can read", async () => {
  await backfill("t-receipt", quiet, async (run) => { run.did(2); run.skip(1); run.drained(); });
  const receipt = JSON.parse(readFileSync(join(".run", "t-receipt.json"), "utf8"));
  assert.equal(receipt.script, "t-receipt");
  assert.equal(receipt.done, 2);
  assert.equal(receipt.skipped, 1);
  assert.equal(receipt.stopped, "drained");
  assert.ok(receipt.startedAt && receipt.endedAt);
  // This is the field the worker needs: "finished the work" and "gave up
  // immediately" were both exit code 0.
  assert.notEqual(receipt.stopped, undefined);
});

test("--budget on the command line overrides the script's default", async () => {
  const argv = process.argv;
  process.argv = ["node", "x", "--budget", "2"];
  try {
    const r = await backfill("t-flag", { budget: 999 }, async (run) => {
      while (run.round()) run.did();
    });
    assert.equal(r.done, 2);
  } finally {
    process.argv = argv;
  }
});

test("the budget is per row, not per page", async () => {
  // Measured the hard way: `npm run rescore -- --budget 1` processed 995 rows,
  // because round() is the OUTER gate and a round is a 2,000-row page.
  const argv = process.argv;
  process.argv = ["node", "x", "--budget", "1"];
  try {
    let rows = 0;
    const r = await backfill("t-perrow", { budget: 999 }, async (run) => {
      while (run.round()) {
        for (let i = 0; i < 2000; i++) {
          if (run.exhausted()) return;
          rows++;
          run.did();
        }
      }
    });
    assert.equal(r.done, 1);
    assert.equal(rows, 1, "it stopped after one row, not after one page");
  } finally {
    process.argv = argv;
  }
});

// round() drives the stall check by comparing progress between calls, so
// calling it per row reads a skipped row as a stalled round.
test("skipped rows do not look like a stalled queue", async () => {
  let seen = 0;
  const r = await backfill("t-skips", { budget: 4 }, async (run) => {
    while (run.round()) {
      for (const ok of [false, false, false, false, true, true, true, true]) {
        seen++;
        if (ok) run.did(); else run.skip();
      }
    }
  });
  assert.equal(r.stopped, "budget");
  assert.equal(r.skipped, 4, "four skips in a row did not end the run");
});

test("a bare positional argument is not mistaken for the budget", async () => {
  // indexOf returns -1 when the flag is absent, and -1 + 1 is 0. Five of the
  // six hand-written copies of this parser had that bug.
  const argv = process.argv;
  process.argv = ["node", "x", "7"];
  try {
    const r = await backfill("t-positional", { budget: 3 }, async (run) => {
      while (run.round()) run.did();
    });
    assert.equal(r.done, 3, "the script's own default stands");
  } finally {
    process.argv = argv;
  }
});

// Forty lines of hill-climbing with direction reversal and a periodic re-probe,
// pure and integer-in/integer-out — and until the entry-point guard landed, no
// test could reach it without launching an embedding run against the pool.
test("the adaptive batch sizer can finally be called at all", async () => {
  const lines: string[] = [];
  const log = (l: string) => lines.push(l);
  // A first window only establishes a baseline; it must not move the batch.
  for (let i = 0; i < 6; i++) tuneAfterBatch(100, log);
  assert.deepEqual(lines, []);
  // A second window with a very different rate does move it.
  for (let i = 0; i < 6; i++) tuneAfterBatch(1, log);
  assert.ok(lines.some((l: string) => l.includes("[tune]")), "a rate change retunes the batch");
});

// The channel candidate 5 rests on: clear, run, read.
test("a receipt cleared before a run cannot be mistaken for that run's answer", async () => {
  await backfill("t-chan", quiet, async (run) => { run.did(4); run.drained(); });
  assert.equal(readRun("t-chan")?.done, 4);

  // The 0xC0000142 case: the child never starts, so it never writes. Without
  // clearing first, the parent would read the PREVIOUS run as today's answer.
  clearRun("t-chan");
  assert.equal(readRun("t-chan"), null, "no receipt means the child never reached finish()");
});

test("the endings a single exit code could not tell apart", async () => {
  // Both of these used to be exit code 0, and reading "nothing to do" as
  // "could not work" is what climbed the backoff ladder over a finished lane
  // for 33 hours.
  await backfill("t-end-a", quiet, async (run) => { run.drained(); });
  await backfill("t-end-b", quiet, async (run) => {
    while (run.round()) { run.failed(); run.failed(); run.failed(); }
  });
  assert.equal(readRun("t-end-a")?.stopped, "drained");
  assert.equal(readRun("t-end-b")?.stopped, "failstreak");
});

test("nothing outside backfill.ts hand-writes the run scaffolding", async () => {
  const offenders: string[] = [];
  // board-sweep manages its own state file and network waits, migrate-layered
  // is a one-off over raw SQL, and the worker IS the scheduler rather than a
  // backfill. Everything else goes through the runner.
  const ALLOW = new Set([
    "scripts/board-sweep.ts",     // its own state file, network waits and RAM-aware slicing
    "scripts/migrate-layered.ts", // one-off, over raw SQL rather than Prisma
    "scripts/worker.ts",          // the scheduler, not a backfill: it SPAWNS these
    // A one-shot importer: walks a fixed curated list once and creates boards.
    // No queue to drain, no GPU, nothing to resume — there is no run to own.
    "scripts/import-sustainability.ts",
  ]);

  for (const rel of readdirSync("scripts", { recursive: true }) as string[]) {
    const path = join("scripts", String(rel)).replace(/\\/g, "/");
    if (!path.endsWith(".ts") || ALLOW.has(path)) continue;
    const src = readFileSync(path, "utf8");
    if (src.includes("appendFileSync(")) offenders.push(`${path} — writes its own log file`);
    if (src.includes("gpuBusyMessage()")) offenders.push(`${path} — writes its own GPU preamble`);
    if (/indexOf\("--(budget|limit)"\)/.test(src)) offenders.push(`${path} — parses --budget itself`);
  }

  assert.deepEqual(offenders, [], `use backfill() from src/lib/backfill.ts:\n${offenders.join("\n")}`);
});

// Every backfill must be importable without doing its work — the precondition
// for the test above it, and for any test of a script's own logic.
test("importing a backfill script does not start a backfill", () => {
  const offenders: string[] = [];
  const BACKFILLS = [
    "fit-fill", "embed-fill", "desc-fill", "rescore",
    "facts-fill", "repair-descriptions", "fit-review", "fit-rereview",
  ];
  for (const name of BACKFILLS) {
    const src = readFileSync(join("scripts", `${name}.ts`), "utf8");
    if (!src.includes("isEntryPoint")) offenders.push(`${name} — runs on import`);
  }
  assert.deepEqual(offenders, [], offenders.join("\n"));
});

test.after(() => {
  rmSync(".run", { recursive: true, force: true });
  for (const n of ["t-drained", "t-budget", "t-stall", "t-slow", "t-fail", "t-crash", "t-receipt", "t-flag", "t-positional", "t-perrow", "t-skips", "t-chan", "t-end-a", "t-end-b"]) {
    rmSync(`${n}.log`, { force: true });
  }
});
