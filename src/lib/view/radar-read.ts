import { prisma } from "../db";
import { liveWhere, pursuedWhere } from "../queue/pool";
import {
  allowedCountries, countryChips, radarFacetWhere, radarPaging, radarWhere,
  selectedCountries, PAGE_SIZE, RADAR_ORDER, REMOTE_BUCKET, UNKNOWN_BUCKET,
  type RadarFilters,
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
// THREE DEPENDENT WAVES AND ONE INDEPENDENT STREAM. The pool clock comes
// first because the delisted guard needs it; the facet counts second because
// the chips decide which country selections are even valid; the page and its
// count third, needing the final where. The stat snapshot, the starred strip
// and the applied set depend on none of that, so they are STARTED before
// anything is awaited and gathered at the end — serializing them behind the
// waves was this module's own first mistake, made worse by a comment
// declaring the order mandatory. The page had made the sibling mistake
// before, awaiting them after everything else.

// The starred strip is a shortlist, not a query result — bounded, because it
// once had no `take` and a liberal star habit paid an unbounded read on every
// page load.
export const STARRED_MAX = 40;

export async function readRadar(f: RadarFilters, opts: { now?: Date } = {}) {
  // The independent stream: nothing here needs the pool clock or the facet.
  const independent = Promise.all([
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
    prisma.job.count({ where: { AND: [facetWhere, { ...REMOTE_BUCKET }] } }),
    prisma.job.count({ where: { AND: [facetWhere, { ...UNKNOWN_BUCKET }] } }),
  ]);
  const counts = new Map(countryCounts.map((c) => [c.country as string, c._count]));
  const { top, other, otherCount } = countryChips(f, counts);
  const where = radarWhere(f, { poolNewest, top, other });

  // Wave 3 — the page and its count, both needing the final where.
  const [jobs, filteredCount] = await Promise.all([
    prisma.job.findMany({
      where,
      orderBy: [...RADAR_ORDER],
      ...radarPaging(f),
      // Only the tiny coverLetter field crosses the content split — one page
      // of rows, usually null; descriptions stay out of the list path.
      include: { content: { select: { coverLetter: true } } },
    }),
    prisma.job.count({ where }),
  ]);

  // Wave 4 — the text of the postings on this page, by primary key.
  //
  // Descriptions are split off the hot row so that the LIST query — filter and
  // composite-index sort over half a million rows — never pages them. That is
  // the 4ms property, and this does not touch it: the list is already decided,
  // and thirty rows read by id is an index lookup, not a scan. Measured on the
  // real pool: 5ms and 140KB, against the 414ms this whole reading already
  // costs. Cheap enough that the card can hold the posting outright instead of
  // making the reader ask for it, which was the alternative and it wanted a
  // page round trip per expansion.
  const texts = await prisma.jobContent.findMany({
    where: { jobId: { in: jobs.map((j) => j.id) } },
    select: { jobId: true, description: true },
  });
  const descriptions = new Map(texts.map((t) => [t.jobId, t.description]));

  const [snapshot, starred, appliedRows] = await independent;

  const stats = snapshot
    ? (JSON.parse(snapshot.stats) as { total: number; byStatus: Record<string, number>; byVerdict: Record<string, number> })
    : { total: 0, byStatus: {}, byVerdict: {} };
  const appliedCompanies = new Set(appliedRows.map((r) => r.company));
  // The card clock is taken AFTER the reads, so freshness is judged against an
  // instant no older than the data. Injectable for the tests, which need the
  // response deterministic.
  const now = opts.now ?? new Date();

  return {
    jobs,
    filteredCount,
    lastPage: Math.max(1, Math.ceil(filteredCount / PAGE_SIZE)),
    chips: {
      top, other, otherCount, counts, remoteCount, unknownCount,
      // Which of the URL's countries this render honors — the SAME answer the
      // where was built from, so the chip active-state cannot diverge from
      // the query. The page used to re-derive it with a hardcoded bucket list.
      selected: selectedCountries(f, top),
    },
    stats,
    starred,
    appliedCompanies,
    // Keyed by posting id, so a card can only ever show its own text.
    descriptions,
    // One clock and one pool reading for every card in the response, so two
    // postings rendered together cannot be judged fresh against different
    // instants.
    labelCtx: { now, poolNewest: poolNewest ?? undefined, appliedCompanies },
  };
}
