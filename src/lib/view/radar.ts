// THE RADAR'S QUERY: which postings this filter selection asks for.
//
// This was 181 lines inside the page component, built by mutating two `any`
// locals — the exact shadowing hazard pool.ts exists to prevent, kept alive on
// the one surface a user actually looks at. Nothing could call it, so nothing
// could test it, and the cost was not hypothetical: an OR arm re-admitting
// pursued postings sat there for months, correct in shape and impossible to
// match, because the population above it pinned status and the two met in one
// AND. A test would have found that in a line.
//
// Everything here is pure. The page runs the queries; this decides what to ask.

import { andWhere, discoverableWhere } from "../queue/pool";
import { COUNTRY_NAMES, REGION_KEYS, REGIONS } from "../location/geo";
import { DELISTED_AFTER_DAYS } from "../scoring/freshness";

export const VERDICTS = ["all", "strong", "possible", "weak"] as const;
export const WORK_MODES = [
  { value: "remote", label: "remote" },
  { value: "hybrid", label: "hybrid" },
  { value: "onsite", label: "on-site" },
] as const;
export const VISA_TIERS = ["yes", "maybe", "no", "unknown", "not-needed"] as const;
export const VISA_TIER_LABELS: Record<string, string> = {
  yes: "visa: yes", maybe: "visa: maybe", no: "visa: no",
  unknown: "visa: unknown", "not-needed": "no visa needed",
};
// The country chips that are not countries: the long tail, postings with no
// location at all, and locations we could not place.
export const COUNTRY_BUCKETS = ["other", "remote", "unknown"] as const;
export const PAGE_SIZE = 30;

export interface RadarFilters {
  tracks: string[];
  verdict: string;
  workModes: string[];
  regions: string[];
  /** Raw from the URL; validated against the live facet in radarWhere. */
  countries: string[];
  visaTiers: string[];
  q: string;
  page: number;
}

type Params = Record<string, string | undefined>;

function csv(raw: string | undefined, keep: (s: string) => boolean): string[] {
  return (raw ?? "").split(",").map((s) => s.trim()).filter(Boolean).filter(keep);
}

// The URL is untrusted input like any other: every value is validated against
// the vocabulary it belongs to, so an invented track key cannot reach Prisma.
export function radarFilters(sp: Params, trackKeys: readonly string[]): RadarFilters {
  return {
    tracks: csv(sp.track, (s) => trackKeys.includes(s)),
    verdict: (VERDICTS as readonly string[]).includes(sp.verdict ?? "") ? sp.verdict! : "all",
    workModes: csv(sp.loc, (s) => WORK_MODES.some((m) => m.value === s)),
    regions: csv(sp.region, (s) => REGION_KEYS.includes(s)),
    countries: csv(sp.country, () => true),
    visaTiers: csv(sp.visa, (s) => (VISA_TIERS as readonly string[]).includes(s)),
    q: (sp.q ?? "").trim(),
    page: Math.max(1, parseInt(sp.page ?? "1", 10) || 1),
  };
}

// The countries a region selection admits. No region selected means every
// country we have a name for.
export function allowedCountries(f: RadarFilters): string[] {
  return f.regions.length > 0
    ? [...new Set(f.regions.flatMap((r) => [...REGIONS[r]]))]
    : Object.keys(COUNTRY_NAMES);
}

// Everything except the country selection.
//
// The facet counts are computed against THIS, so the chips do not jump while
// the user is picking one — a count that changes as you click it is a count you
// cannot use.
export function radarFacetWhere(f: RadarFilters, poolNewest?: Date | null) {
  const base: Record<string, unknown> = { ...discoverableWhere() };
  if (f.tracks.length) base.track = { in: f.tracks };
  if (f.verdict !== "all") base.fitVerdict = f.verdict;
  if (f.workModes.length) base.workMode = { in: f.workModes };
  if (f.visaTiers.length) base.visaTier = { in: f.visaTiers };

  const parts: Array<Record<string, unknown> | null> = [];
  if (f.q) parts.push({ OR: [{ title: { contains: f.q } }, { company: { contains: f.q } }] });

  // A posting is hidden only when it is GONE, never when it is merely old.
  //
  // The age filter used to drop anything whose postedAt fell outside a 45-day
  // window, and it was measured hiding 74 already-judged postings — 72 of which
  // the model had read and called real openings, 16 of them strong. postedAt
  // does not mean what that filter assumed: Ashby reports a still-open role as
  // published in 2021 because the field records when the record was created.
  // Age is DISCLOSED on the card instead (see labels.ts), never enforced here.
  //
  // What IS enforced is absence: a direct source that has stopped listing a
  // posting while the pool has moved on. Measured against the pool's own clock
  // so a pause in ingesting never retires the pool.
  if (poolNewest) {
    const cutoff = new Date(poolNewest.getTime() - DELISTED_AFTER_DAYS * 86_400_000);
    parts.push({ NOT: { AND: [{ source: { contains: ":" } }, { lastSeenAt: { lt: cutoff } }] } });
  }
  if (f.regions.length) parts.push({ country: { in: allowedCountries(f) } });

  return andWhere(base, ...parts);
}

// The final query, once the facet counts have told us which country chips exist.
//
// `top` is the chips actually offered; a country in the URL that is not among
// them is dropped rather than queried, so a stale bookmark cannot filter the
// radar down to a chip the user cannot see to unset.
export function radarWhere(
  f: RadarFilters,
  ctx: { poolNewest?: Date | null; top: readonly string[]; other: readonly string[] },
) {
  const selected = f.countries.filter(
    (c) => ctx.top.includes(c) || (COUNTRY_BUCKETS as readonly string[]).includes(c),
  );
  if (selected.length === 0) return radarFacetWhere(f, ctx.poolNewest);

  const or: Array<Record<string, unknown>> = [];
  const codes = selected.filter((c) => !(COUNTRY_BUCKETS as readonly string[]).includes(c));
  if (codes.length) or.push({ country: { in: codes } });
  if (selected.includes("other")) or.push({ country: { in: [...ctx.other] } });
  if (selected.includes("remote")) or.push({ country: null, workMode: "remote" });
  if (selected.includes("unknown")) or.push({ country: null, workMode: { not: "remote" } });

  return andWhere(radarFacetWhere(f, ctx.poolNewest), { OR: or });
}

// Which countries get a chip: the ten biggest inside the allowed set, and the
// rest folded into "other".
export function countryChips(f: RadarFilters, counts: ReadonlyMap<string, number>) {
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([c]) => c);
  const other = allowedCountries(f).filter((c) => !top.includes(c));
  return { top, other, otherCount: other.reduce((sum, c) => sum + (counts.get(c) ?? 0), 0) };
}

// Judged first, then the sources that speak for the employer, then keyword
// score. createdAt breaks the remaining ties so paging is stable.
export const RADAR_ORDER = [
  { fitScore: { sort: "desc", nulls: "last" } },
  { sourceTrust: "desc" },
  { score: "desc" },
  { createdAt: "desc" },
] as const;

export function radarPaging(f: RadarFilters) {
  return { skip: (f.page - 1) * PAGE_SIZE, take: PAGE_SIZE };
}
