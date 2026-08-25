import test from "node:test";
import assert from "node:assert/strict";
import { hostOf, pump, PER_HOST } from "../src/lib/ingest/fetch";
import { platforms } from "../src/lib/discovery/platforms";
import type { Source } from "../src/lib/sources/types";

// THE PUMP, MEASURED.
//
// This scheduler existed twice and the two copies disagreed about which host a
// source talks to, so the sweep capped apply.workable.com at 2 while the normal
// ingest capped nothing at all. Both copies READ correctly — the normal one
// even carried a comment saying "shared-host platforms keep a politeness cap".
// Only running it tells you whether a cap binds, so these tests count what is
// actually in flight rather than inspecting the table.

// A source that reports when it starts and finishes, so a test can watch the
// schedule instead of the result. Never rejects unless asked to.
function probe(name: string, log: { now: number; peak: number; perHost: Map<string, number>; peakHost: Map<string, number> }, opts: { fail?: boolean } = {}): Source {
  return {
    name,
    fetch: async () => {
      const h = hostOf(name);
      log.now++;
      log.peak = Math.max(log.peak, log.now);
      log.perHost.set(h, (log.perHost.get(h) ?? 0) + 1);
      log.peakHost.set(h, Math.max(log.peakHost.get(h) ?? 0, log.perHost.get(h)!));
      await new Promise((r) => setTimeout(r, 5));
      log.now--;
      log.perHost.set(h, log.perHost.get(h)! - 1);
      if (opts.fail) throw new Error("boom");
      return [];
    },
  };
}

const meter = () => ({ now: 0, peak: 0, perHost: new Map<string, number>(), peakHost: new Map<string, number>() });

test("a source's host is its platform, its provider, or its own name", () => {
  assert.equal(hostOf("board:workable:acme"), "workable", "a discovered board is hosted BY a platform");
  assert.equal(hostOf("board:recruitee:acme|eu"), "recruitee", "region suffixes ride on the token");
  assert.equal(hostOf("lever:dreamgames"), "lever", "a curated company leads with its ATS");
  assert.equal(hostOf("eures"), "eures", "an aggregator answers for itself");
});

test("every capped host is a platform that can actually produce sources", () => {
  // The drift that prompted this module: a cap table whose keys nothing could
  // ever produce. Board sources are named `board:<platform>:<token>`, so a key
  // is only reachable if it is a real platform id.
  const known = new Set(platforms.map((p) => p.id));
  for (const host of Object.keys(PER_HOST)) {
    assert.ok(known.has(host), `${host} is not a platform id — nothing can be scheduled under it`);
    assert.equal(hostOf(`board:${host}:acme`), host);
  }
});

test("the per-host cap binds on discovered boards — the case that never applied", async () => {
  // Twelve boards on ONE platform, a global bound of 8. Under the old normal
  // ingest every one of them hashed to the word "board", which the cap table
  // does not contain, so all 8 went to apply.workable.com at once — the exact
  // load that was measured returning 429.
  const log = meter();
  const sources = Array.from({ length: 12 }, (_, i) => probe(`board:workable:c${i}`, log));
  await pump(sources, (s) => s.fetch().then(() => undefined), {
    concurrency: 8,
    perHost: PER_HOST,
    heapMB: () => 0,
  });
  assert.equal(log.peakHost.get("workable"), 2, "at most two at a time to one host");
  assert.equal(log.peak, 2, "and nothing else was runnable, so that is the whole run");
});

test("an uncapped host runs up to the global bound, and never past it", async () => {
  const log = meter();
  const sources = Array.from({ length: 20 }, (_, i) => probe(`board:greenhouse:c${i}`, log));
  await pump(sources, (s) => s.fetch().then(() => undefined), { concurrency: 5, heapMB: () => 0 });
  assert.equal(log.peak, 5);
});

test("a saturated platform does not block the queue behind it", async () => {
  // Ten capped boards first, then one aggregator. If the pump only ever looked
  // at the head of the queue, the aggregator would wait for all ten.
  const log = meter();
  const sources = [
    ...Array.from({ length: 10 }, (_, i) => probe(`board:join:c${i}`, log)),
    probe("eures", log),
  ];
  await pump(sources, (s) => s.fetch().then(() => undefined), {
    concurrency: 6,
    perHost: PER_HOST,
    heapMB: () => 0,
  });
  assert.equal(log.peakHost.get("join"), 2);
  assert.equal(log.peak, 3, "two joins plus the aggregator that skipped past them");
});

test("heap pressure narrows the pump to single file", async () => {
  const log = meter();
  const sources = Array.from({ length: 6 }, (_, i) => probe(`board:greenhouse:c${i}`, log));
  await pump(sources, (s) => s.fetch().then(() => undefined), { concurrency: 8, heapMB: () => 1500 });
  assert.equal(log.peak, 1, "above the critical threshold nothing runs alongside anything");
});

test("moderate heap pressure halves the bound", async () => {
  const log = meter();
  const sources = Array.from({ length: 10 }, (_, i) => probe(`board:greenhouse:c${i}`, log));
  await pump(sources, (s) => s.fetch().then(() => undefined), { concurrency: 8, heapMB: () => 900 });
  assert.equal(log.peak, 4);
});

test("pressure never RAISES the bound above what the caller asked for", async () => {
  // `Math.max(2, floor(conc / 2))` did: throttle a sweep to one in flight, let
  // the heap cross the threshold, and memory pressure doubled the parallelism
  // on the one path the branch exists to protect.
  // DISTINCT hosts, or the raise cannot show: an unlisted host defaults to the
  // CONFIGURED bound, so eight boards on one platform are capped at `conc`
  // anyway and the widened global limit has nothing to spend itself on.
  for (const conc of [1, 2, 3, 8]) {
    const log = meter();
    const sources = Array.from({ length: 8 }, (_, i) => probe(`board:p${i}:acme`, log));
    await pump(sources, (s) => s.fetch().then(() => undefined), { concurrency: conc, heapMB: () => 900 });
    assert.ok(log.peak <= conc, `conc ${conc} ran ${log.peak} at once`);
    assert.ok(log.peak >= 1);
  }
});

test("shuffling changes the order, never the identity or the caller's array", async () => {
  // The buckets the normal ingest reassembles are indexed by the ORIGINAL
  // position, which is what makes "source order wins dedupe" survive a
  // politeness-driven fetch order.
  const log = meter();
  const sources = Array.from({ length: 30 }, (_, i) => probe(`board:greenhouse:c${i}`, log));
  const frozen = [...sources];
  const seen: Array<[string, number]> = [];
  await pump(sources, async (src, i) => { seen.push([src.name, i]); }, {
    concurrency: 1, shuffle: true, heapMB: () => 0,
  });
  assert.deepEqual(sources, frozen, "the pump does not reorder what it was handed");
  assert.equal(seen.length, 30, "every source is worked exactly once");
  for (const [name, i] of seen) assert.equal(sources[i].name, name, "the index always names the source");
  assert.ok(seen.some(([, i], at) => i !== at), "and the order really was shuffled");
});

test("a rejecting body costs one source, not the run", async () => {
  // The pump has nowhere to report to; a rejection escaping the scheduler
  // would be an unhandled rejection taking the process down mid-sweep.
  const log = meter();
  const sources = [
    probe("board:greenhouse:ok1", log),
    probe("board:greenhouse:bad", log, { fail: true }),
    probe("board:greenhouse:ok2", log),
  ];
  let worked = 0;
  await pump(sources, async (s) => { await s.fetch(); worked++; }, { concurrency: 2, heapMB: () => 0 });
  assert.equal(worked, 2, "the two good sources finished");
});

test("an empty source list resolves instead of hanging", async () => {
  await pump([], async () => {}, { concurrency: 4 });
});

test("a cap of zero cannot strand its sources", async () => {
  // Otherwise the pump waits forever on work it may never start.
  const log = meter();
  const sources = [probe("board:join:a", log), probe("board:join:b", log)];
  await pump(sources, (s) => s.fetch().then(() => undefined), {
    concurrency: 4, perHost: { join: 0 }, heapMB: () => 0,
  });
  assert.equal(log.peak, 1);
});
