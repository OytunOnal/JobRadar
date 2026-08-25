import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { backfill, clearRun, readRun, runNameFor } from "../src/lib/queue/backfill";
import { tuneAfterBatch } from "../scripts/backfill/embed-fill";

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

test("bookkeeping that fails does not unfinish a finished run", async () => {
  // CI stayed red for six pushes on this. The last thing finish() does is
  // close the database connection, and on a machine with no .env that threw
  // `Environment variable not found: DATABASE_URL` — so a run that had done
  // its work reported an error instead of a result. Locally invisible: .env
  // is not committed, so only CI ever ran without one.
  //
  // The receipt write next to it already had this rule written down. This is
  // the same rule, one line later.
  const { prisma } = await import("../src/lib/db");
  const real = prisma.$disconnect.bind(prisma);
  prisma.$disconnect = async () => { throw new Error("no DATABASE_URL"); };
  try {
    const r = await backfill("t-disconnect", quiet, async (run) => {
      run.did(4);
      run.drained();
    });
    assert.equal(r.stopped, "drained");
    assert.equal(r.done, 4, "the work is what happened; the disconnect is not");
    assert.equal(readRun("t-disconnect")?.done, 4, "and the receipt still landed");
  } finally {
    prisma.$disconnect = real;
  }
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
  for (let i = 0; i < 6; i++) tuneAfterBatch(1000, log);
  assert.deepEqual(lines, []);

  // A second window whose measured rate is unmistakably lower. The sleep is
  // load-bearing, not padding: the tuner divides work by elapsed time, and six
  // calls inside one millisecond measure Infinity/Infinity — which compares
  // equal to itself and retunes nothing. This test was flaky until it made the
  // two windows take visibly different amounts of time.
  for (let i = 0; i < 5; i++) tuneAfterBatch(1, log);
  await new Promise((r) => setTimeout(r, 30));
  tuneAfterBatch(1, log);
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

// A script is SPAWNED BY PATH and files its receipt BY NAME. Those two agreed
// until the scripts moved into subdirectories, at which point the worker looked
// for `.run/backfill/embed-fill.json` while the child wrote
// `.run/embed-fill.json` — every read came back null, every pass reported no
// progress, and the backoff ladder pinned itself at thirty minutes. A rename
// reintroduced the stall the whole receipt channel exists to prevent, and
// nothing caught it because nothing held the two halves together.
test("the name the worker reads is the name the child writes", () => {
  const worker = readFileSync(join("scripts", "pipeline", "worker.ts"), "utf8");

  // Every script the worker spawns, taken from the spawn calls themselves.
  const spawned = [...worker.matchAll(/runChild\(\s*"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(spawned.length >= 2, `expected spawn calls, found ${spawned.length}`);

  for (const path of new Set(spawned)) {
    const src = readFileSync(path, "utf8");
    // The name the child hands to backfill() is the name it files under.
    const declared = src.match(/backfill\(\s*"([^"]+)"/)?.[1];
    assert.ok(declared, `${path} does not call backfill() with a name`);
    assert.equal(
      runNameFor(path),
      declared,
      `the worker would read .run/${runNameFor(path)}.json but ${path} writes .run/${declared}.json`,
    );
  }
});

// The worker and the lock have to agree on what travels between them, and the
// two halves sit in different files with a process boundary in between — the
// arrangement that has already broken this project twice, once when a rename
// desynchronised the receipt name and once when a delegation flag said that
// someone had delegated without saying which run. Neither is a type error:
// both sides are strings.
test("the worker hands down the run id the lock expects to receive", () => {
  const worker = readFileSync(join("scripts", "pipeline", "worker.ts"), "utf8");
  const lock = readFileSync(join("src", "lib", "queue", "gpu-lock.ts"), "utf8");

  const expected = lock.match(/const TOKEN = "([A-Z_]+)"/)?.[1];
  assert.ok(expected, "the lock module must name the variable it reads");
  assert.match(
    worker,
    // String.raw, because `\s` and `\(` in an ordinary template literal are
    // just `s` and `(` — the regex would quietly stop meaning what it says.
    // Same trap the runNameFor case below documents.
    new RegExp(String.raw`env:[^}]*${expected}:\s*gpuToken\(\)`),
    `the worker must spawn children with ${expected} set from gpuToken()`,
  );

  // And nothing may still be speaking the retired dialect.
  for (const [file, src] of [["worker.ts", worker], ["gpu-lock.ts", lock]] as const) {
    assert.doesNotMatch(src, /JOBRADAR_GPU_DELEGATED/, `${file} still uses the delegation flag`);
  }
});

test("runNameFor takes the bare script name, whatever the directory", () => {
  assert.equal(runNameFor("scripts/backfill/embed-fill.ts"), "embed-fill");
  assert.equal(runNameFor("scripts/embed-fill.ts"), "embed-fill");
  assert.equal(runNameFor("embed-fill.ts"), "embed-fill");
  // String.raw, because `\b` and `\f` are escape sequences in an ordinary TS
  // string — the naive spelling of this case asserts on a backspace character
  // and passes for the wrong reason.
  assert.equal(runNameFor(String.raw`scripts\backfill\fit-fill.ts`), "fit-fill");
  // A digit in the extension. Nothing routes a .ps1 through here today, but
  // the helper reads as general and a letters-only strip would have left
  // `chain-embed-then-fit.ps1` in the receipt name.
  assert.equal(runNameFor("scripts/chain-embed-then-fit.ps1"), "chain-embed-then-fit");
  assert.equal(runNameFor("scripts/init-config.mjs"), "init-config");
});

test("nothing outside backfill.ts hand-writes the run scaffolding", async () => {
  const offenders: string[] = [];
  // board-sweep manages its own state file and network waits, migrate-layered
  // is a one-off over raw SQL, and the worker IS the scheduler rather than a
  // backfill. Everything else goes through the runner.
  const ALLOW = new Set([
    "scripts/pipeline/board-sweep.ts",     // its own state file, network waits and RAM-aware slicing
    "scripts/pipeline/worker.ts",          // the scheduler, not a backfill: it SPAWNS these
    // A one-shot importer: walks a fixed curated list once and creates boards.
    // No queue to drain, no GPU, nothing to resume — there is no run to own.
    "scripts/tools/import-sustainability.ts",
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
    const src = readFileSync(join("scripts", "backfill", `${name}.ts`), "utf8");
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
