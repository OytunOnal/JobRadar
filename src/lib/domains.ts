// Shared domain knowledge: which job URLs are junk, which are walls, and how
// much to trust each source when ranking.

// SEO farms and mass-repost mills. A listing whose apply URL lives here is a
// scraped copy — never store it (the original usually arrives via a better
// source), and never spend a harvest resolve on it.
export const JUNK_DOMAINS: readonly string[] = [
  "whatjobs.com", "mysmartpros.com", "jobtome.com", "learn4good.com",
  "bebee.com", "jooble.org", "talent.com", "expertini.com", "jobrapido.com",
  // Freelance-marketplace gigs, not jobs — user decision 2026-08-19.
  "upwork.com",
];

// Real listings behind a login/marketplace wall: fine to store (the job is
// real), pointless to harvest-resolve (the chain dies at the wall).
export const WALL_DOMAINS: readonly string[] = [
  "linkedin.com", "indeed.com", "glassdoor.com", "glassdoor.co.uk",
  "ziprecruiter.com",
];

function hostMatches(host: string, domains: readonly string[]): boolean {
  return domains.some((d) => host === d || host.endsWith("." + d));
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function isJunkJobUrl(url: string): boolean {
  const host = hostOf(url);
  return host !== null && hostMatches(host, JUNK_DOMAINS);
}

export function isWallJobUrl(url: string): boolean {
  const host = hostOf(url);
  return host !== null && hostMatches(host, WALL_DOMAINS);
}

// Ranking trust tiers, stored on Job at ingest:
//   2 — direct from the company's ATS (source "gh:x", "workable:x", ...):
//       first-party, deduped winner, apply link goes straight to the company
//   1 — curated remote boards (Remotive, WWR, ...): human-reviewed listings
//   0 — mass aggregators (Adzuna, JSearch): real jobs mixed with reposts
const TIER0_SOURCES = new Set(["adzuna", "jsearch", "indeed"]);

export function sourceTrust(source: string): number {
  if (source.includes(":")) return 2;
  if (TIER0_SOURCES.has(source)) return 0;
  return 1;
}

// ── Canonical posting URLs ───────────────────────────────────────────────────
// Strip only a DENYLIST of known tracking params (career-ops' url-key lesson,
// which mirrors RFC 3986 §6): over-normalizing merges two genuinely different
// postings (silent data loss), under-normalizing leaves a visible duplicate.
// Generic names (ref, source, src) are deliberately KEPT — they are
// functional on some boards (gh_jid is a Greenhouse posting id).
const TRACKING_PARAMS = [
  /^utm_/i, /^gh_src$/i, /^fbclid$/i, /^gclid$/i, /^msclkid$/i,
  /^mc_cid$/i, /^mc_eid$/i, /^igshid$/i, /^_hsenc$/i, /^_hsmi$/i,
  /^trk$/i, /^trackingid$/i, /^wt_mc$/i,
];

// Returns the cleaned URL, or the input unchanged when it isn't http(s).
export function canonicalJobUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return raw;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return raw;
  u.hostname = u.hostname.toLowerCase();
  u.hash = "";
  const kept = [...u.searchParams.entries()].filter(
    ([k]) => !TRACKING_PARAMS.some((re) => re.test(k)),
  );
  kept.sort(([a], [b]) => a.localeCompare(b));
  u.search = kept.length ? `?${new URLSearchParams(kept).toString()}` : "";
  let out = u.toString();
  if (u.pathname !== "/" && out.endsWith("/") && !u.search) out = out.slice(0, -1);
  return out;
}
