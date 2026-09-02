import test from "node:test";
import assert from "node:assert/strict";
import { drain, formatQueueGauges } from "../src/lib/queue/capacity";

// The operator's gauge. The pure halves only — the counts come from
// predicates that already have their own tests (judgeQueueWhere, factsWhere's
// guard, staleVectorWhere).

test("drain time is depth over the window's daily pace", () => {
  // The real numbers from the week the gauge was designed on: 21,733 deep,
  // 1,111 judged in the starved week vs 720 the day the starvation fix
  // landed. Both were true; the 7-day window is why the gauge said 137.
  assert.equal(drain(21_733, 1_111, 7).drainDays, 137);
  assert.equal(Math.round(drain(21_733, 720 * 7, 7).perDay), 720);
  assert.equal(drain(21_733, 720 * 7, 7).drainDays, 30);
});

test("a queue nobody worked drains in infinity, not in a crash", () => {
  const d = drain(500, 0, 7);
  assert.equal(d.drainDays, Infinity);
  assert.match(formatQueueGauges([{ name: "judge", depth: 500, ...d }])[0]!, /∞ — nothing worked this week/);
});

test("slow queues speak in drain time, fast queues in depth alone", () => {
  const lines = formatQueueGauges([
    { name: "judge", depth: 21_733, perDay: 158.7, drainDays: 137 },
    { name: "embed", depth: 1_240 },
  ]);
  assert.match(lines[0]!, /judge\s+21,733 deep · 159\/day \(7d\) · ~137d to drain/);
  // Depth that does not fall between reports is the fast queue's alarm — the
  // 445k stale-vector incident would have been this line printing the same
  // number every day.
  assert.match(lines[1]!, /embed\s+1,240 deep\s+\(fast queue/);
});
