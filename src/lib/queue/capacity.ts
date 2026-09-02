import { prisma } from "../db";
import { judgeQueueWhere } from "../llm/fit";
import { factsQueueWhere } from "../llm/facts";
import { staleVectorWhere } from "../llm/embed";
import { andWhere, openWhere } from "./pool";

// THE OPERATOR'S GAUGE: is the GPU keeping up with the pool?
//
// Growth changes this codebase now (#13-#16 all feed the same queues), and we
// have lived what growing blind costs twice: 445k vectors silently stale, and
// a worker that starved for a day while its log looked busy. The gauge is one
// report block, printed where the pressure is created — the end of an ingest —
// so the operator who just grew the pool reads, in the same breath, what the
// growth did to the machine's ability to keep up. Observability, not UI: no
// user surface shows this.
//
// Three queues, two shapes of number:
//
//   * judge and facts are SLOW queues (a minute and five seconds per row), so
//     each gets depth, 7-day daily pace, and DRAIN TIME — depth over pace,
//     "how many days until empty at last week's tempo". The 7-day window
//     smooths GPU-off evenings; the day the starvation bug was fixed, the
//     1-day pace said 30 days while the 7-day said 137, and both were true.
//   * embed is a FAST queue (thousands per hour when it runs), so drain time
//     would always read ~0 and inform nobody. Its alarm is DEPTH THAT DOES
//     NOT FALL between reports — the 445k incident would have been this line
//     printing the same number every day. Depth only, and no timestamp
//     column was added just to compute a pace nobody would read.
//
// Drain time is a ratio, which is what lets it survive productization: on a
// strong GPU it reads days, in keyword-only mode the queues barely exist, and
// no hard threshold had to be picked for hardware we have not seen. Growth
// PRs quote it (before, and expected after); nothing merges on a number
// unseen.

const DAY = 86_400_000;

export interface QueueGauge {
  name: string;
  depth: number;
  /** Rows worked per day, averaged over the window. Absent for fast queues. */
  perDay?: number;
  /** depth / perDay, rounded. Infinity renders as "∞" — a stopped queue. */
  drainDays?: number;
}

/** Pure half: pace and drain time from a depth and a windowed count. */
export function drain(depth: number, workedInWindow: number, windowDays: number): { perDay: number; drainDays: number } {
  const perDay = workedInWindow / windowDays;
  return { perDay, drainDays: perDay > 0 ? Math.round(depth / perDay) : Infinity };
}

export async function readQueueGauges(now: Date = new Date()): Promise<QueueGauge[]> {
  const since = new Date(now.getTime() - 7 * DAY);
  const [judgeDepth, judged, factsDepth, extracted, embedDepth] = await Promise.all([
    prisma.job.count({ where: judgeQueueWhere(true, now) }),
    prisma.llmJudgmentHistory.count({ where: { at: { gte: since } } }),
    prisma.job.count({ where: factsQueueWhere() }),
    prisma.postingFacts.count({ where: { at: { gte: since } } }),
    prisma.job.count({ where: andWhere(openWhere(), staleVectorWhere()) }),
  ]);
  return [
    { name: "judge", depth: judgeDepth, ...drain(judgeDepth, judged, 7) },
    { name: "facts", depth: factsDepth, ...drain(factsDepth, extracted, 7) },
    { name: "embed", depth: embedDepth },
  ];
}

/** One aligned line per queue, ready for the ingest report. */
export function formatQueueGauges(gauges: QueueGauge[]): string[] {
  return gauges.map((g) => {
    const head = `${g.name.padEnd(6)} ${g.depth.toLocaleString("en").padStart(8)} deep`;
    if (g.perDay === undefined) return `${head}  (fast queue — alarm is depth that does not fall)`;
    const pace = `${Math.round(g.perDay).toLocaleString("en")}/day (7d)`;
    const eta = g.drainDays === Infinity ? "∞ — nothing worked this week" : `~${g.drainDays}d to drain`;
    return `${head} · ${pace} · ${eta}`;
  });
}
