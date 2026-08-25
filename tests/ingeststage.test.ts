import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pass, stage, ERR_MAX } from "../src/lib/ingest/stage";
import { RateLimitError } from "../src/lib/llm/llm";

// THE STAGE ENVELOPE.
//
// Nine stages carried nine hand-written copies of the same four lines, drifted
// into four truncation lengths, two suppression counters and two readings of a
// rate limit. What follows pins the envelope; the last test is a source scan,
// because the failure mode of this module is not a wrong answer — it is a
// tenth copy appearing next to it.

test("a stage that fails costs its own contribution and nothing else", async () => {
  const errors: string[] = [];
  const got = await stage("harvest", errors, async () => { throw new Error("host unreachable"); });
  assert.equal(got, undefined, "undefined IS the report saying this stage has nothing");
  assert.deepEqual(errors, ["harvest: host unreachable"]);
});

test("a stage that works returns its value and says nothing", async () => {
  const errors: string[] = [];
  assert.equal(await stage("liveness", errors, async () => 42), 42);
  assert.deepEqual(errors, []);
});

test("a failure message is bounded, so one stack trace cannot be the report", async () => {
  const errors: string[] = [];
  await stage("harvest", errors, async () => { throw new Error("x".repeat(5000)); });
  assert.equal(errors[0].length, "harvest: ".length + ERR_MAX);
});

test("a non-Error rejection still reads as something", async () => {
  const errors: string[] = [];
  await stage("liveness", errors, async () => { throw "just a string"; });
  assert.deepEqual(errors, ["liveness: just a string"]);
});

test("row failures name their row, and stop flooding after a handful", async () => {
  const errors: string[] = [];
  await stage("dedup", errors, async (p) => {
    for (let i = 0; i < 12; i++) {
      try { throw new Error(`bad row ${i}`); } catch (e) { p.failed(e, `job-${i}`); }
    }
  });
  assert.equal(errors.length, 6, "five examples plus one total");
  assert.equal(errors[0], "dedup job-0: bad row 0");
  assert.equal(errors[4], "dedup job-4: bad row 4");
  assert.equal(errors[5], "dedup: 7 more row failures suppressed");
});

test("a handful of row failures is reported in full, with no summary line", async () => {
  const errors: string[] = [];
  await stage("dedup", errors, async (p) => {
    for (let i = 0; i < 3; i++) {
      try { throw new Error("nope"); } catch (e) { p.failed(e, `job-${i}`); }
    }
  });
  assert.equal(errors.length, 3);
  assert.ok(!errors.some((e) => e.includes("suppressed")));
});

test("a rate limit is a stopping point, not a row failure and not an error", async () => {
  // The provider has said stop, so every remaining row would fail the same
  // way. Two stages used to read this independently, with two sentences and
  // two counts; what the report needs is the reason, since the count of what
  // WAS done is already one of its own fields.
  const errors: string[] = [];
  let rowsTried = 0;
  await stage("fit", errors, async (p) => {
    for (let i = 0; i < 10; i++) {
      rowsTried++;
      try { throw new RateLimitError("429"); } catch (e) { p.failed(e, `job-${i}`); }
    }
  });
  assert.equal(rowsTried, 1, "the pass ends at the first one, it does not grind through ten");
  assert.deepEqual(errors, ["fit stopped: token budget reached"]);
});

test("what a stage did before the rate limit is kept", async () => {
  const errors: string[] = [];
  let dupes = 0;
  await stage("dedup", errors, async (p) => {
    for (let i = 0; i < 10; i++) {
      if (i < 3) { dupes++; continue; }
      try { throw new RateLimitError("429"); } catch (e) { p.failed(e); }
    }
  });
  assert.equal(dupes, 3, "the work already done is the run's, not the provider's");
});

test("a pass is the same bookkeeping WITHOUT the isolation", async () => {
  // The ingest's own store loop uses this: a broken store pass is a broken
  // run, and swallowing it would report a successful ingest of nothing.
  const errors: string[] = [];
  await assert.rejects(
    () => pass("store", errors, async () => { throw new Error("db gone"); }),
    /db gone/,
  );
  assert.deepEqual(errors, [], "an error that propagates is reported by whoever catches it");
});

test("a pass still summarizes its rows before it rethrows", async () => {
  const errors: string[] = [];
  await assert.rejects(() => pass("store", errors, async (p) => {
    for (let i = 0; i < 8; i++) {
      try { throw new Error("row"); } catch (e) { p.failed(e); }
    }
    throw new Error("and then the loop itself died");
  }));
  assert.equal(errors.at(-1), "store: 3 more row failures suppressed");
});

test("no tenth copy: every ingest failure goes through the envelope", () => {
  // This module exists because nine hand-written copies drifted. A source scan
  // is the only thing that fails when a tenth appears — a behavioural test
  // cannot see code that was never called.
  const src = readFileSync("src/lib/ingest/index.ts", "utf8");
  const pushes = src.match(/report\.errors\.push/g) ?? [];
  assert.deepEqual(pushes, [], "record failures through stage() or pass(), not by hand");
  const truncations = src.match(/\.slice\(0,\s*\d{2,3}\)/g) ?? [];
  assert.deepEqual(truncations, [], "message() owns how much of a failure survives");
});
