import type { Source } from "../sources/types";

// ONE PUMP, AND THE HOST RULE IT SCHEDULES BY.
//
// An ingest fetches its sources concurrently under three constraints: a global
// bound, a per-host bound, and the machine's heap. That scheduler existed
// TWICE — once for the board sweep, once for the normal ingest — with the same
// 1200/800 thresholds, the same in-flight map, the same recursive pump, and
// two different answers to one question: which host is this source's requests
// going to.
//
// The sweep read the platform out of `board:workable:acme` and capped it. The
// normal ingest took the segment before the first colon, which for EVERY
// discovered board is the literal word "board" — a key its cap table does not
// contain. And no curated company uses join, workable or recruitee (they run
// on ashby, greenhouse, lever, smartrecruiters and eight others), so in a
// normal ingest that cap table matched nothing at all. The politeness cap that
// exists because apply.workable.com answered 429 at 8-wide, live, had never
// once applied outside the sweep, while the comment above it said it did.
//
// So the rule gets one home, and `tests/fetchpump.test.ts` measures the cap
// actually binding rather than trusting that it reads well.

// The host a source's requests will land on.
//
//   board:workable:acme  -> workable   (a discovered board, hosted by a platform)
//   lever:dreamgames     -> lever      (a curated company on its ATS)
//   eures                -> eures      (an aggregator answers for itself)
//
// One rule, not a table: a discovered board wears its platform one segment in,
// behind the `board:` marker that says the platform is not the source's own
// identity. Everything else already leads with the host it talks to.
export function hostOf(sourceName: string): string {
  const rest = sourceName.startsWith("board:") ? sourceName.slice("board:".length) : sourceName;
  return rest.split(":")[0];
}

/**
 * The sources a `--only` selection asks for.
 *
 * Two differently-named things have to answer to one word: an aggregator is
 * "eures", a discovered board is "board:recruitee:acme", and a user asking for
 * "recruitee" means every board on that platform. That is the same question
 * `hostOf` already answers — and asking it here fixes a selection that never
 * worked: the rule used to take the segment before the first colon, which for
 * every discovered board is "board", so `--only recruitee` matched nothing at
 * all while its own comment said it matched every recruitee board.
 *
 * An empty or blank-only selection means "everything", which is what a caller
 * passing no --only gets.
 */
export function selectSources(sources: readonly Source[], only?: readonly string[]): Source[] {
  const wanted = new Set((only ?? []).map((s) => s.trim().toLowerCase()).filter(Boolean));
  if (wanted.size === 0) return [...sources];
  return sources.filter((s) => {
    const name = s.name.toLowerCase();
    return wanted.has(name) || wanted.has(hostOf(name));
  });
}

// Platforms that serve every one of their boards from ONE host, so N boards
// means N simultaneous requests to the same machine. Measured, not guessed:
// apply.workable.com started answering 429 at eight in flight.
export const PER_HOST: Readonly<Record<string, number>> = { join: 2, workable: 2, recruitee: 2 };

// Above CRITICAL the pump goes single-file; above HIGH it halves. Sampled per
// scheduling decision rather than once per run, because a sweep slice's heap
// climbs while it runs — which is the whole reason this is adaptive.
const HEAP_CRITICAL_MB = 1200;
const HEAP_HIGH_MB = 800;

export interface PumpOptions {
  /** Upper bound on simultaneous work, before heap pressure lowers it. */
  concurrency: number;
  /** Simultaneous work per host. A host not listed gets the global bound. */
  perHost?: Readonly<Record<string, number>>;
  /**
   * Fetch in random order. The discovered pool arrives in PLATFORM BLOCKS
   * (crawl insertion order), so a slice taken off the front can be 1500
   * consecutive requests to one host; mixing spreads the concurrency across
   * distinct hosts before the per-host cap has to.
   */
  shuffle?: boolean;
  /** Heap reading in MB. Injectable so a test can prove the pump reacts. */
  heapMB?: () => number;
}

/**
 * Work every source, concurrently, under the bounds above.
 *
 * `work` receives the source and its ORIGINAL index — shuffling changes the
 * order things are fetched in, never the identity of what came back. That
 * separation is what lets the normal ingest reassemble results in priority
 * order (source order decides who wins dedupe) while still fetching in
 * whatever order is politest.
 *
 * `work` must not reject: the pump has nowhere to report to, and a rejection
 * escaping the scheduler would take the process down mid-run. Rejections are
 * swallowed here; recording a failed source is the caller's job, next to the
 * report it owns.
 */
export async function pump(
  sources: readonly Source[],
  work: (src: Source, index: number) => Promise<void>,
  opts: PumpOptions,
): Promise<void> {
  const conc = Math.max(1, opts.concurrency);
  const perHost = opts.perHost ?? {};
  const heapMB = opts.heapMB ?? (() => process.memoryUsage().heapUsed / 1_048_576);
  // A cap of zero would leave its sources permanently unschedulable and the
  // pump waiting on work it can never start, so the floor is structural.
  const capOf = (host: string): number => Math.max(1, perHost[host] ?? conc);
  const limitNow = (): number => {
    const mb = heapMB();
    if (mb > HEAP_CRITICAL_MB) return 1;
    if (mb > HEAP_HIGH_MB) return Math.max(2, Math.floor(conc / 2));
    return conc;
  };

  const pending = sources.map((_, i) => i);
  if (opts.shuffle) {
    for (let i = pending.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pending[i], pending[j]] = [pending[j], pending[i]];
    }
  }

  const inFlight = new Map<string, number>();
  let active = 0;
  await new Promise<void>((resolve) => {
    const next = (): void => {
      while (active < limitNow()) {
        // The first pending source whose host is under its cap — not the first
        // pending source, so one saturated platform never blocks the queue
        // behind it.
        const qi = pending.findIndex((i) => {
          const h = hostOf(sources[i].name);
          return (inFlight.get(h) ?? 0) < capOf(h);
        });
        if (qi === -1) break;
        const i = pending.splice(qi, 1)[0];
        const h = hostOf(sources[i].name);
        inFlight.set(h, (inFlight.get(h) ?? 0) + 1);
        active++;
        void Promise.resolve()
          .then(() => work(sources[i], i))
          .catch(() => {})
          .finally(() => {
            inFlight.set(h, (inFlight.get(h) ?? 0) - 1);
            active--;
            next();
          });
      }
      if (pending.length === 0 && active === 0) resolve();
    };
    next();
  });
}
