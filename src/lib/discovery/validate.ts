import { prisma } from "../db";
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
    res = await fetchImpl(url, makeInit());
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
}

export async function runValidation(
  opts: { concurrency?: number; fetchImpl?: typeof fetch; limit?: number } = {},
): Promise<ValidationReport> {
  const cutoff = new Date(Date.now() - RECHECK_DAYS * 86_400_000);
  const boards = await prisma.atsBoard.findMany({
    where: {
      OR: [
        { status: "candidate" },
        { validatedAt: null },
        { validatedAt: { lt: cutoff } },
      ],
    },
    orderBy: { id: "asc" },
    ...(opts.limit ? { take: opts.limit } : {}),
  });

  const report: ValidationReport = { checked: 0, active: 0, dead: 0, revived: 0, errors: 0 };
  const queue = [...boards];

  const workers = Array.from(
    { length: Math.min(opts.concurrency ?? 10, queue.length) },
    async () => {
      while (queue.length > 0) {
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
