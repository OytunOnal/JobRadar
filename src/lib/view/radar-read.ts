import { prisma } from "../db";
import { liveWhere, pursuedWhere } from "../queue/pool";
import {
  allowedCountries, countryChips, radarFacetWhere, radarPaging, radarWhere,
  PAGE_SIZE, RADAR_ORDER, type RadarFilters,
} from "./radar";

// THE RADAR READING: everything one render of the radar needs, read once.
//
// radar.ts decides what to ask and stays pure; this module does the asking.
// The nine queries used to live in the page component, which meant the
// sequencing knowledge lived there too — and their invariants (the chips must
// not jump while a country is being picked, the starred strip must ignore the
// filters) could only be checked by rendering. Same split the pool has:
// pool.ts owns the predicates, pursuit.ts owns the effects; radar.ts owns the
// question, this owns the round trips.
//
// THREE WAVES, AND THE ORDER IS NOT A PREFERENCE. The pool clock comes first
// because the delisted guard needs it; the facet counts come second because
// the country chips decide which country selections are even valid; only then
// can the final where be built and everything else fetched in one parallel
// wave. A caller cannot be trusted to remember that — one already forgot: the
// starred strip and the applied set were once awaited on their own, and a
// page load paid five sequential round trips where three suffice.

// The starred strip is a shortlist, not a query result — bounded, because it
// once had no `take` and a liberal star habit paid an unbounded read on every
// page load.
export const STARRED_MAX = 40;

export type RadarReading = Awaited<ReturnType<typeof readRadar>>;

export async function readRadar(f: RadarFilters, opts: { now?: Date } = {}) {
  const now = opts.now ?? new Date();

  // Wave 1 — the pool's own clock: how far the newest observation has
  // advanced. Guards the delisted check against "we simply haven't ingested
  // lately".
  const poolNewest = (await prisma.job.aggregate({ _max: { lastSeenAt: true } }))._max.lastSeenAt;

  // Wave 2 — the facet: counted against every filter EXCEPT the country
  // selection, so the chips do not jump while the user is picking one.
  const allowed = allowedCountries(f);
  const facetWhere = radarFacetWhere(f, poolNewest);
  const [countryCounts, remoteCount, unknownCount] = await Promise.all([
    prisma.job.groupBy({ by: ["country"], _count: true, where: { AND: [facetWhere, { country: { in: allowed } }] } }),
    prisma.job.count({ where: { AND: [facetWhere, { country: null, workMode: "remote" }] } }),
    prisma.job.count({ where: { AND: [facetWhere, { country: null, workMode: { not: "remote" } }] } }),
  ]);
  const counts = new Map(countryCounts.map((c) => [c.country as string, c._count]));
  const { top, other, otherCount } = countryChips(f, counts);
  const where = radarWhere(f, { poolNewest, top, other });

  // Wave 3 — everything else, in parallel.
  const [jobs, filteredCount, snapshot, starred, appliedRows] = await Promise.all([
    prisma.job.findMany({
      where,
      orderBy: [...RADAR_ORDER],
      ...radarPaging(f),
      // Only the tiny coverLetter field crosses the content split — one page
      // of rows, usually null; descriptions stay out of the list path.
      include: { content: { select: { coverLetter: true } } },
    }),
    prisma.job.count({ where }),
    // The stat strip reads the ingest-end snapshot — one row instead of
    // group-by'ing half a million (measured cause of slow filter clicks).
    prisma.dashboardStatsSnapshot.findFirst({ orderBy: { at: "desc" } }),
    // The user's own shortlist, unaffected by the filters.
    prisma.job.findMany({
      where: { ...liveWhere(), status: "interested" },
      orderBy: [{ fitScore: { sort: "desc", nulls: "last" } }, { score: "desc" }],
      take: STARRED_MAX,
    }),
    // Companies with an application in progress — their remaining postings get
    // a badge and a one-click "hide the rest".
    prisma.job.findMany({ where: pursuedWhere(), select: { company: true }, distinct: ["company"] }),
  ]);

  const stats = snapshot
    ? (JSON.parse(snapshot.stats) as { total: number; byStatus: Record<string, number>; byVerdict: Record<string, number> })
    : { total: 0, byStatus: {}, byVerdict: {} };
  const appliedCompanies = new Set(appliedRows.map((r) => r.company));

  return {
    jobs,
    filteredCount,
    lastPage: Math.max(1, Math.ceil(filteredCount / PAGE_SIZE)),
    chips: { top, other, otherCount, counts, remoteCount, unknownCount },
    stats,
    starred,
    appliedCompanies,
    // One clock and one pool reading for every card in the response, so two
    // postings rendered together cannot be judged fresh against different
    // instants.
    labelCtx: { now, poolNewest: poolNewest ?? undefined, appliedCompanies },
  };
}
