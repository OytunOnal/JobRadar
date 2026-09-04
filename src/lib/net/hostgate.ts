// ONE POLITENESS BUDGET PER HOST, SHARED BY EVERY LANE.
//
// Politeness has always been per-host in this project — the reason eight
// platform probes can run at once is that they go to eight different
// companies' servers. What was missing is that the limit lived INSIDE each
// caller: ingest/fetch.ts's pump has its own perHost caps, the name probe has
// its own inter-name pause, board validation has its own concurrency. Each is
// correct alone, and the moment two of them run at the same time a host sees
// the sum of their limits rather than one limit.
//
// That mattered the day the ingest went from serial stages to concurrent
// lanes: name-probe and board validation hit the SAME platform hosts —
// greenhouse, workable, recruitee — so running them side by side without a
// shared counter would rebuild, from two directions, exactly the burst that
// earned a fourteen-hour retry-after from Workable.
//
// So the gate is module state on purpose. A host's budget is a property of
// the host, not of whichever lane happened to reach it first.

/** In-flight cap per host. Two lanes asking at once still see one budget.
 *
 * Raised from 2 to 4 on measurement, not on appetite. A full ingest reported
 * every platform host at roughly 1.2 requests a second, with queue time at 10%
 * of busy time — the hosts were idle and we were the slow party. The gate's
 * own rule cuts both ways: too many workers queue at it, too few leave its
 * allowance unspent, and the report said plainly which side we were on.
 *
 * Four keeps the politest host at about 2.4 requests a second, which is still
 * gentler than any single board fetch this project already does. */
const MAX_IN_FLIGHT = Number(process.env.HOST_MAX_IN_FLIGHT) || 4;

/** Minimum gap between two request STARTS to the same host. */
const MIN_GAP_MS = Number(process.env.HOST_MIN_GAP_MS) || 250;

interface HostState {
  inFlight: number;
  lastStart: number;
  /** Resolvers waiting for a slot, in arrival order. */
  waiting: (() => void)[];
  /** Observability: how often we asked, and how long we queued for it. */
  requests: number;
  waitMs: number;
  busyMs: number;
}

const hosts = new Map<string, HostState>();

/** Registrable-ish host key: the last two labels, so a tenant subdomain and
 *  the platform's API share one budget. "acme.recruitee.com" and
 *  "api.recruitee.com" are one server operator and must not get two. */
export function hostKey(url: string): string {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return url;
  }
  const parts = host.split(".");
  if (parts.length <= 2) return host;
  // Keep three labels for the common two-part public suffixes we actually
  // meet (co.uk, com.au, gov.cz), so example.co.uk stays one key.
  const tail2 = parts.slice(-2).join(".");
  if (/^(co|com|gov|org|net|ac)\.[a-z]{2}$/.test(tail2)) return parts.slice(-3).join(".");
  return tail2;
}

const state = (key: string): HostState =>
  hosts.get(key) ??
  (hosts.set(key, { inFlight: 0, lastStart: 0, waiting: [], requests: 0, waitMs: 0, busyMs: 0 }),
  hosts.get(key)!);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Run `fn` under the host's budget: at most MAX_IN_FLIGHT at a time, and never
 * two starts inside MIN_GAP_MS.
 *
 * Waiters are woken in arrival order, so a lane that queued first is not
 * starved by one that keeps asking — the failure mode a bare "retry until free"
 * loop has, and the reason this hands out slots rather than polling.
 */
export async function withHost<T>(url: string, fn: () => Promise<T>): Promise<T> {
  const key = hostKey(url);
  const s = state(key);
  // Queue time is measured separately from work time, because once lanes run
  // concurrently a stage's elapsed clock stops meaning what it used to: it
  // now includes however long the stage sat behind ANOTHER lane at this gate.
  // Without the split, a slow stage and a starved one look identical.
  const queuedAt = Date.now();

  while (s.inFlight >= MAX_IN_FLIGHT) {
    await new Promise<void>((resolve) => s.waiting.push(resolve));
  }
  // RESERVE BEFORE AWAITING ANYTHING. The first version incremented after the
  // inter-request gap, which is a check-then-act race: ten callers all passed
  // the while-check while inFlight was still zero, all slept through the gap
  // together, and all entered. Measured — the host saw nine at once under a
  // cap of two. The slot has to be taken in the same synchronous step that
  // observed it free.
  s.inFlight++;
  const gap = MIN_GAP_MS - (Date.now() - s.lastStart);
  if (gap > 0) await sleep(gap);
  s.lastStart = Date.now();
  s.requests++;
  s.waitMs += s.lastStart - queuedAt;
  const startedAt = s.lastStart;
  try {
    return await fn();
  } finally {
    s.busyMs += Date.now() - startedAt;
    s.inFlight--;
    s.waiting.shift()?.();
  }
}

export interface HostStat {
  host: string;
  requests: number;
  waitMs: number;
  busyMs: number;
}

/** Per-host contention, worst queue time first — the report's answer to
 *  "was that stage slow, or was it waiting its turn?". */
export function hostStats(): HostStat[] {
  return [...hosts]
    .map(([host, s]) => ({ host, requests: s.requests, waitMs: s.waitMs, busyMs: s.busyMs }))
    .filter((h) => h.requests > 0)
    .sort((a, b) => b.waitMs - a.waitMs);
}

/**
 * How many workers a lane should run to USE the gate's allowance without
 * exceeding it: distinct hosts times the per-host cap.
 *
 * This is the sizing rule the worker counts in this project never had. They
 * were inherited defaults — validation ran ten because ten was what it had
 * always run — and once the gate became the real limit those numbers stopped
 * meaning anything on their own. Too many workers queue at the gate (visible
 * now as host queueing in the report); too few leave the allowance unspent,
 * which is what the name probe was doing when it walked names one at a time
 * across nine platforms.
 *
 * Bounded, because a queue spanning a hundred hosts does not justify two
 * hundred workers on one machine.
 */
export function workersForHosts(distinctHosts: number, max = 24): number {
  return Math.max(1, Math.min(max, distinctHosts * MAX_IN_FLIGHT));
}

/** The per-host in-flight cap. Exported so callers and tests can reason in
 *  terms of the budget rather than restating its current number — a test that
 *  hardcodes 2 fails when the cap is tuned to 4, which pins the wrong thing:
 *  the property worth defending is that the gate HOLDS the cap. */
export function hostInFlightCap(): number {
  return MAX_IN_FLIGHT;
}

/** Tests only: forget every host's budget. */
export function resetHostGate(): void {
  hosts.clear();
}
