import { prisma } from "../db";
import { listCcSnapshots, runCrawl, type CrawlReport } from "./crawl";

// THE RECURRING ARCHIVE SCAN (#15): discovery that grows by itself.
//
// Common Crawl publishes a fresh index roughly monthly and newly founded
// companies keep appearing in it; the Wayback Machine updates continuously
// and its CDX API takes a from= timestamp. This module rides the daily
// ingest: each run asks "is there archive material I have not seen?", and
// about once a month the answer is yes and a scan runs. No OS scheduler, no
// cron — a missed month self-heals because the question is asked against the
// archives' own state, not against a calendar.
//
// Nearly free on ordinary days, by two gates:
//   * DATE GATE, no HTTP: while the newest scanned index is younger than
//     three weeks, a new one cannot exist (CC's cadence is monthly), so most
//     days cost one SourceState read and nothing else.
//   * COLLINFO GATE, one ~2KB request: past three weeks, the live crawl list
//     is fetched and compared against what SourceState remembers. Only an
//     actually-unscanned index triggers the 10-20 minute scan.
//
// Memory is SourceState, the existing name→timestamp map: one row per
// scanned index (`ccindex:CC-MAIN-2026-36` — presence means scanned) and one
// `wayback-incremental` row holding the last Wayback cut. The first run
// starts at the newest index only: the bulk sweep already covered history,
// and "everything unscanned" on a fresh row-set would mean re-scanning a
// decade.

const CC_PREFIX = "ccindex:";
const WB_KEY = "wayback-incremental";
export const CHECK_AFTER_DAYS = 21;
const DAY = 86_400_000;

/** Newest-first collinfo ids → the ones we owe a scan. Bounded on a fresh
 * install to the single newest index; otherwise everything newer than the
 * newest scanned one, however many months were missed. */
export function unscannedIds(collinfoNewestFirst: string[], scanned: ReadonlySet<string>): string[] {
  if (scanned.size === 0) return collinfoNewestFirst.slice(0, 1);
  const out: string[] = [];
  for (const id of collinfoNewestFirst) {
    if (scanned.has(id)) break; // everything past here predates our coverage
    out.push(id);
  }
  return out;
}

/** The no-HTTP gate: a new index cannot exist while the newest scan is young. */
export function checkDue(newestScanAt: Date | null, now: Date): boolean {
  if (!newestScanAt) return true;
  return now.getTime() - newestScanAt.getTime() > CHECK_AFTER_DAYS * DAY;
}

/** CDX timestamp (yyyyMMdd) for the incremental Wayback cut. */
export function cdxDay(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

export interface RecrawlReport {
  scanned: string[]; // CC index ids scanned this run
  waybackFrom: string;
  crawl: CrawlReport;
}

/** Ask, and scan only when the archives have something we have not seen.
 * Returns null on the (usual) nothing-to-do days. */
export async function recrawlIfDue(
  now: Date = new Date(),
  log: (m: string) => void = () => {},
): Promise<RecrawlReport | null> {
  const states = await prisma.sourceState.findMany({
    where: { name: { startsWith: CC_PREFIX } },
    select: { name: true, lastFetchedAt: true },
  });
  const newest = states.reduce<Date | null>(
    (m, s) => (m && m > s.lastFetchedAt ? m : s.lastFetchedAt), null);
  if (!checkDue(newest, now)) return null;

  const collinfo = await listCcSnapshots();
  if (!collinfo) return null; // unreachable — tomorrow's ingest asks again
  const scanned = new Set(states.map((s) => s.name.slice(CC_PREFIX.length)));
  const due = unscannedIds(collinfo, scanned);
  if (due.length === 0) return null;

  const wbState = await prisma.sourceState.findUnique({ where: { name: WB_KEY } });
  // First incremental cut reaches back 45 days rather than to the bulk
  // sweep's 2023 default — history is the bulk sweep's job, not this lane's.
  const waybackFrom = cdxDay(wbState?.lastFetchedAt ?? new Date(now.getTime() - 45 * DAY));

  log(`archive scan due: ${due.join(", ")} + wayback since ${waybackFrom}`);
  const crawl = await runCrawl({
    sources: ["commoncrawl", "wayback"],
    snapshotIds: due,
    waybackFrom,
    log,
  });

  // Scanned means scanned even when the scan limped: a partial-error run
  // still walked the index, and re-walking it tomorrow would not heal what
  // failed (the report carries the errors for the operator). The Wayback cut
  // moves to now for the same reason.
  for (const id of due) {
    await prisma.sourceState.upsert({
      where: { name: CC_PREFIX + id },
      update: { lastFetchedAt: now },
      create: { name: CC_PREFIX + id, lastFetchedAt: now },
    });
  }
  await prisma.sourceState.upsert({
    where: { name: WB_KEY },
    update: { lastFetchedAt: now },
    create: { name: WB_KEY, lastFetchedAt: now },
  });

  return { scanned: due, waybackFrom, crawl };
}
