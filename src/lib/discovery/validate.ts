import { prisma } from "../db";
import { withHost, workersForHosts } from "../net/hostgate";
import { getPlatform } from "./platforms";

// Validation runner: probes AtsBoard candidates against the registry's
// endpoints and settles their status.
//
//   candidate ──probe──▶ active | dead
//   active    ──30d──▶ re-probed (name refresh, death detection)
//   dead      ──30d──▶ re-probed (companies come back — e.g. a SmartRecruiters
//                       board with zero live postings reads dead by design)
//
// Probe rules collected while building the registry, all encoded there:
//   - redirect: "manual" ALWAYS (Personio/BambooHR/Breezy 307/302 dead boards
//     to healthy marketing pages)
//   - method/body from probeRequest (Workday needs a JSON POST; GET = 400)
//   - liveness from probeAlive when present (SmartRecruiters 200s for any name)
//   - a network error is NOT death: status only flips on a definitive response

const UA = "JobRadar/0.1 (personal job search)";
const RECHECK_DAYS = 30;

// COHORTS ARE THE REAL SCHEDULING PROBLEM, not the budget. Boards validated
// together fall due together: 68,336 of ours were validated on 2026-08-19, so
// under a flat 30-day cutoff every one of them would come due on the same
// morning — a single ingest owing 68,000 probes, about four hours, against a
// normal day's 2,400. Raising the per-run cap cannot fix that; it only spreads
// one spike across a fortnight of ingests while new work piles up behind it.
//
// So each board gets its own recheck window, RECHECK_DAYS plus a deterministic
// 0-29 day offset from its id. A bulk-validated cohort therefore comes due
// evenly across the following month instead of all at once, which turns the
// spike into the flat ~2,400/day the lane was sized for. Deterministic rather
// than random so a board's due date does not wander between runs.
const RECHECK_SPREAD_DAYS = 30;

// "good-job-games" → "Good Job Games"; workday "gapinc@wd1/ext" → "Gapinc".
export function titleizeToken(token: string): string {
  const base = token.includes("@") ? token.split("@")[0] : token;
  return base
    .replace(/[-_.]+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// Company name from the probe body where the API offers one. `body` is parsed
// JSON when the response parses, else the raw text (Personio's XML).
const JOB_COUNTERS: Record<string, (body: any) => number | undefined> = {
  lever: (b) => (Array.isArray(b) ? b.length : undefined),
  ashby: (b) => (Array.isArray(b?.jobs) ? b.jobs.length : undefined),
  workable: (b) => (Array.isArray(b?.jobs) ? b.jobs.length : undefined),
  recruitee: (b) => (Array.isArray(b?.offers) ? b.offers.length : undefined),
  smartrecruiters: (b) => (typeof b?.totalFound === "number" ? b.totalFound : undefined),
  personio: (b) =>
    typeof b === "string" ? (b.match(/<position>/g) ?? []).length : undefined,
  // PositionCountCustomer is the tenant's whole board, not the page: the
  // probe asks for take=1, so counting Items would report 1 for every live
  // board and 0 for none.
  hrmanager: (b) =>
    typeof b?.PositionCountCustomer === "number" ? b.PositionCountCustomer : undefined,
};

const NAME_EXTRACTORS: Record<string, (body: any) => string | null | undefined> = {
  greenhouse: (b) => b?.name,
  workable: (b) => b?.name,
  recruitee: (b) => b?.offers?.[0]?.company_name,
  smartrecruiters: (b) => b?.content?.[0]?.company?.name,
  personio: (b) =>
    typeof b === "string" ? b.match(/<subcompany>([^<]*)<\/subcompany>/)?.[1]?.trim() || null : null,
  manatal: (b) => b?.name,
  hrmanager: (b) => b?.CustomerName,
};

// Platforms that asked us to go away, and when we may ask again. In-memory:
// a restart re-tests, which is the cheapest correct invalidation, and the
// window is capped so a hostile header cannot retire a platform forever.
const throttledUntil = new Map<string, number>();
const MAX_THROTTLE_MS = 6 * 60 * 60 * 1_000;

// THE THROTTLE WE KEPT HITTING WAS ONE WE EARNED.
//
// Boards are discovered in bulk, so the table clusters by platform: the first
// 120 rows of a real validation queue read teamtailor, breezy, teamtailor,
// then 117 consecutive Workable boards — out of 907 waiting. Ten workers on
// that queue meant ten simultaneous requests to a single host, which is the
// shape that earns a 429; Workable answered one with retry-after 52,362
// seconds and every Workable board then sat behind our own breaker.
//
// PER-HOST LIMITS NOW LIVE IN ONE PLACE. This module used to keep its own
// in-flight counter, which was right until the ingest ran lanes concurrently
// — at which point board validation and the name probe each enforced a
// private budget on the SAME hosts and a server saw the sum. net/hostgate.ts
// holds the single budget; the count that used to be here would now be a
// second opinion, and two places answering "how much may this host take" is
// exactly the drift this project keeps having to undo.
//
// What stays here is the part the gate cannot do: ORDER. Interleaving spreads
// the queue across platforms so workers find work on many hosts instead of
// queueing behind one, which is what lets the gate's allowance actually get
// used rather than merely respected.

/** Round-robin the queue across platforms so bulk-discovered blocks do not
 *  arrive at one host as a burst. Order within a platform is preserved. */
export function interleaveByPlatform<T extends { platform: string }>(boards: T[]): T[] {
  const lanes = new Map<string, T[]>();
  for (const b of boards) {
    const lane = lanes.get(b.platform);
    if (lane) lane.push(b);
    else lanes.set(b.platform, [b]);
  }
  const out: T[] = [];
  const queues = [...lanes.values()];
  let live = true;
  while (live) {
    live = false;
    for (const q of queues) {
      const next = q.shift();
      if (next) {
        out.push(next);
        live = true;
      }
    }
  }
  return out;
}
const DEFAULT_THROTTLE_MS = 10 * 60 * 1_000;

/** Which platforms are standing down, for the report. */
export function throttledPlatforms(now = Date.now()): string[] {
  return [...throttledUntil.entries()].filter(([, t]) => t > now).map(([p]) => p);
}

export interface ProbeOutcome {
  result: "active" | "dead" | "error";
  companyName?: string | null;
  // Live posting count when the probe body carries one (workable/recruitee/
  // smartrecruiters/personio). undefined = the probe can't tell (greenhouse
  // probes the board root, which has no job list).
  jobCount?: number;
}

export async function probeBoard(
  platformId: string,
  token: string,
  region: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 10_000,
): Promise<ProbeOutcome> {
  const platform = getPlatform(platformId);
  if (!platform) return { result: "error" };
  const url = platform.probeUrl(token, region);
  if (!url) return { result: "error" };

  const until = throttledUntil.get(platformId);
  if (until && until > Date.now()) return { result: "error" }; // asked to wait

  const makeInit = (): RequestInit => ({
    method: platform.probeRequest?.method ?? "GET",
    headers: { "User-Agent": UA, ...platform.probeRequest?.headers },
    body: platform.probeRequest?.body,
    redirect: "manual",
    signal: AbortSignal.timeout(timeoutMs),
  });

  let res: Response;
  try {
    // Through the shared host gate: board validation and the name probe hit
    // the SAME platform hosts, so once they run as concurrent lanes their
    // separate limits would sum on one server. One budget per host, whoever
    // asks.
    res = await withHost(url, () => fetchImpl(url, makeInit()));
  } catch {
    return { result: "error" };
  }
  if (res.status === 429) {
    // BELIEVE THE HEADER. This used to sleep five seconds and ask again,
    // which was both useless and expensive: measured 2026-09-02, Workable
    // answers 429 with retry-after 52,362 SECONDS — fourteen hours — so the
    // retry bought a second refusal, and inside a parallel probe batch that
    // one throttled host set the pace for all eight (8.5s per name against
    // ~300ms for every other platform). Stand down for as long as we were
    // asked, and let the other platforms run at their own speed.
    const after = Number(res.headers.get("retry-after"));
    const waitMs = Number.isFinite(after) && after > 0
      ? Math.min(after * 1_000, MAX_THROTTLE_MS)
      : DEFAULT_THROTTLE_MS;
    throttledUntil.set(platformId, Date.now() + waitMs);
    return { result: "error" }; // never "dead": a refusal is not an answer
  }

  let body: unknown = null;
  if (res.status === 200) {
    const text = await res.text().catch(() => "");
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  const alive = platform.probeAlive ? platform.probeAlive(res.status, body) : res.status === 200;
  if (!alive) return { result: "dead" };
  return {
    result: "active",
    companyName: NAME_EXTRACTORS[platformId]?.(body) ?? null,
    jobCount: JOB_COUNTERS[platformId]?.(body),
  };
}

export interface ValidationReport {
  checked: number;
  active: number;
  dead: number;
  revived: number; // dead boards that came back
  errors: number;
  /** Boards left in the queue because their platform is standing down. */
  skipped?: number;
}

export async function runValidation(
  opts: { concurrency?: number; fetchImpl?: typeof fetch; limit?: number } = {},
): Promise<ValidationReport> {
  // The per-board window makes this awkward for the query builder — it
  // compares validatedAt against a cutoff that depends on the row's own id —
  // so the selection is raw SQL. Prisma stores SQLite DateTime as epoch
  // MILLISECONDS, not as a datetime string, so the comparison is arithmetic;
  // a first attempt using datetime() silently matched every row in the table.
  const dayMs = 86_400_000;
  const baseCutoff = Date.now() - RECHECK_DAYS * dayMs;
  const limit = opts.limit ?? 1_000_000;
  const boards = await prisma.$queryRaw<
    { id: number; platform: string; token: string; region: string; status: string; companyName: string | null }[]
  >`
    SELECT id, platform, token, region, status, companyName
    FROM AtsBoard
    WHERE status = 'candidate'
       OR validatedAt IS NULL
       OR validatedAt < (${baseCutoff} - (id % ${RECHECK_SPREAD_DAYS}) * ${dayMs})
    ORDER BY id ASC
    LIMIT ${limit}
  `;

  // A PLATFORM STANDING DOWN IS NOT WORK, IT IS A CLOSED DOOR. Interleaving
  // stops us EARNING a throttle; it does nothing about one we are already
  // serving. Measured mid-throttle: 120 Workable boards "checked" in one
  // second, 119 errors — a fifth of a run's budget spent on probes we knew
  // would fail before we sent them, while other platforms waited.
  //
  // So throttled platforms are dropped from the queue rather than probed and
  // counted. Their boards keep status and validatedAt untouched and come back
  // next run, which is what the breaker already promised; the difference is
  // that the budget now goes to hosts that will answer. This is also what
  // makes the per-platform cap tolerable: when the tail is one platform and
  // that platform is blocked, there is no tail to wait on.
  const standingDown = new Set(throttledPlatforms());
  const probeable = standingDown.size > 0
    ? boards.filter((b) => !standingDown.has(b.platform))
    : boards;

  const report: ValidationReport = { checked: 0, active: 0, dead: 0, revived: 0, errors: 0 };
  report.skipped = boards.length - probeable.length;
  const queue = interleaveByPlatform(probeable);

  // Sized from the gate rather than from habit: enough workers to use every
  // host's allowance, never more than the queue has work for. The old default
  // was ten — which under-served a queue spanning nine platforms (18 slots)
  // and over-served the Workable-dominated one (2), in the same run.
  const distinctHosts = new Set(queue.map((b) => b.platform)).size;
  const workers = Array.from(
    { length: Math.min(opts.concurrency ?? workersForHosts(distinctHosts), queue.length) },
    async () => {
      while (queue.length > 0) {
        // Straight off the front: the queue is already interleaved across
        // platforms, and net/hostgate.ts decides what any one host will take.
        // A worker that lands on a saturated host waits INSIDE the gate, in
        // arrival order, rather than spinning here — which is also why the
        // wait shows up as host queueing in the report instead of vanishing
        // into a stage's elapsed time.
        const b = queue.shift()!;
        const outcome = await probeBoard(b.platform, b.token, b.region, opts.fetchImpl ?? fetch);
        report.checked++;
        if (outcome.result === "error") {
          // Leave status AND validatedAt untouched so the next run retries it.
          report.errors++;
          continue;
        }
        if (outcome.result === "active") {
          report.active++;
          if (b.status === "dead") report.revived++;
        } else {
          report.dead++;
        }
        await prisma.atsBoard.update({
          where: { id: b.id },
          data: {
            status: outcome.result,
            validatedAt: new Date(),
            // Prefer the API's own name; never blank an existing one.
            companyName: outcome.companyName ?? b.companyName ?? titleizeToken(b.token),
          },
        });
      }
    },
  );
  await Promise.all(workers);
  return report;
}
