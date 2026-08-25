import { RateLimitError } from "../llm/llm";

// THE ENVELOPE AROUND AN INGEST STAGE.
//
// An ingest is one fetch-and-store core with a dozen stages hung off it —
// sponsor refresh, harvest, name probes, deep probes, liveness, location
// resolution, semantic dedup, auto-fit, the dashboard snapshot. Every one of
// them was wrapped by hand in the same four lines, and the copies had drifted
// into four different truncations (160 five times, 140, 100, and twice none at
// all), two independent "stop logging after N failures" counters with two
// different N and two different sentences, and two independent readings of
// what a RateLimitError means.
//
// The bodies are NOT the same and this module does not touch them: dedup's
// two-tier budget, fit's inter-call throttle, the snapshot's group-bys are
// what those stages are for. Same split backfill.ts made for scripts — the
// caller keeps the loop, and hands it to something that owns everything
// around it.
//
// The rule that makes a stage a stage: its failure is RECORDED and never sinks
// the ingest. A stage that could not run costs its own contribution to the
// report and nothing else, because the run has already spent minutes of
// network time and dropping that on the floor to report a harvest error would
// be the worse trade.

// How much of a failure's message survives into the report. One number,
// because the four that existed were four accidents rather than four
// judgements.
export const ERR_MAX = 160;

// Row failures reported in full before the rest are merely counted. The first
// trial run's report was flooded one line per failing row; a handful of
// examples plus a total says the same thing.
const SHOWN_FAILURES = 5;

export interface Pass {
  /**
   * One row failed — not the pass. The first few are reported with their
   * reference; the rest are counted and summarized on the way out.
   *
   * A RateLimitError is NOT a row failure and is rethrown: the provider has
   * said stop, so every remaining row would fail the same way. It ends the
   * pass and is reported as a stopping point rather than as an error, which is
   * the honest reading — the work is not wrong, it is unfinished.
   */
  failed(e: unknown, ref?: string): void;
}

export function message(e: unknown): string {
  return String((e as Error)?.message ?? e).slice(0, ERR_MAX);
}

/**
 * Run one pass, summarizing the rows that failed inside it. Failures
 * PROPAGATE — this is for the ingest's own core, where a broken pass is a
 * broken run.
 *
 * How far a pass got is not this module's business: every stage that can stop
 * early already has a counter in the report, and the report is printed. What
 * would otherwise be a second copy of that number here is the drift this whole
 * module exists to remove.
 */
export async function pass<T>(
  name: string,
  errors: string[],
  body: (p: Pass) => Promise<T>,
): Promise<T> {
  let failures = 0;
  const p: Pass = {
    failed(e: unknown, ref?: string) {
      if (e instanceof RateLimitError) throw e;
      failures++;
      if (failures <= SHOWN_FAILURES) {
        errors.push(`${name}${ref ? ` ${ref}` : ""}: ${message(e)}`);
      }
    },
  };
  try {
    return await body(p);
  } catch (e) {
    if (e instanceof RateLimitError) errors.push(`${name} stopped: token budget reached`);
    throw e;
  } finally {
    if (failures > SHOWN_FAILURES) {
      errors.push(`${name}: ${failures - SHOWN_FAILURES} more row failures suppressed`);
    }
  }
}

/**
 * A stage: one pass whose failure is recorded and never sinks the ingest.
 * Returns undefined when it could not run, which is how the report says "this
 * stage has nothing to contribute" without a second flag.
 *
 * Which means a stage that stops PART WAY loses whatever it was going to
 * return. Checked, not assumed: deep-probe and location resolution are the
 * only assigning stages that touch a model, and each makes exactly one chat()
 * call before it writes anything, so there is no partial answer to lose.
 * Harvest and the name probes make none. The stages that DO accumulate — dedup
 * and fit — write into the report as they go rather than returning, which is
 * what makes their partial work survive, and is the shape any future
 * accumulating stage should copy.
 */
export async function stage<T>(
  name: string,
  errors: string[],
  body: (p: Pass) => Promise<T>,
): Promise<T | undefined> {
  try {
    return await pass(name, errors, body);
  } catch (e) {
    // A RateLimitError has already reported itself as a stopping point, and a
    // stage that stopped early is not a stage that failed.
    if (!(e instanceof RateLimitError)) errors.push(`${name}: ${message(e)}`);
    return undefined;
  }
}
