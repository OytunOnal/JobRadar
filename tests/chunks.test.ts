import test from "node:test";
import assert from "node:assert/strict";
import { chunkFromHistogram, chunkLabel, chunkWhere, chunkFromArgs, CHUNK_TARGET } from "../src/lib/chunks";

test("takes from the top until the target is reached", () => {
  const c = chunkFromHistogram([
    { score: 100, n: 300 }, { score: 90, n: 400 }, { score: 80, n: 500 }, { score: 40, n: 9000 },
  ], 1000);
  assert.deepEqual(c, { lo: 80, hi: 100, n: 1200 });
});

test("never splits a score value — it overshoots instead", () => {
  // 3,352 postings share score 40 on the live pool. Cutting that group by
  // count would be arbitrary: within one score only similarity can
  // discriminate, and similarity is exactly what is not computed yet.
  const c = chunkFromHistogram([{ score: 40, n: 3352 }], 1000)!;
  assert.equal(c.n, 3352);
  assert.equal(c.lo, 40);
  assert.equal(c.hi, 40);
});

test("a single score chunk labels itself as one score", () => {
  assert.equal(chunkLabel({ lo: 40, hi: 40, n: 10 }), "puan 40");
  assert.equal(chunkLabel({ lo: 80, hi: 100, n: 10 }), "puan 80-100");
});

test("empty and all-zero histograms yield no chunk", () => {
  assert.equal(chunkFromHistogram([]), null);
  assert.equal(chunkFromHistogram([{ score: 50, n: 0 }]), null);
});

test("scores out of order still chunk from the highest down", () => {
  const c = chunkFromHistogram([{ score: 40, n: 900 }, { score: 95, n: 100 }, { score: 70, n: 50 }], 120)!;
  assert.equal(c.hi, 95);
  assert.equal(c.lo, 70);
  assert.equal(c.n, 150);
});

test("the range round-trips through the CLI flags the child receives", () => {
  const c = chunkFromHistogram([{ score: 90, n: 1200 }], CHUNK_TARGET)!;
  const parsed = chunkFromArgs(["--min-score", String(c.lo), "--max-score", String(c.hi)])!;
  assert.deepEqual(chunkWhere(parsed), { score: { gte: 90, lte: 90 } });
});

test("no --min-score means no range filter at all", () => {
  assert.equal(chunkFromArgs(["--wide"]), null);
  assert.deepEqual(chunkWhere(null), {});
});
