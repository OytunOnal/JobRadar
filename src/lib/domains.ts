// Shared domain knowledge: which job URLs are junk, which are walls, and how
// much to trust each source when ranking.

// SEO farms and mass-repost mills. A listing whose apply URL lives here is a
// scraped copy — never store it (the original usually arrives via a better
// source), and never spend a harvest resolve on it.
export const JUNK_DOMAINS: readonly string[] = [
  "whatjobs.com", "mysmartpros.com", "jobtome.com", "learn4good.com",
  "bebee.com", "jooble.org", "talent.com", "expertini.com", "jobrapido.com",
];

// Real listings behind a login/marketplace wall: fine to store (the job is
// real), pointless to harvest-resolve (the chain dies at the wall).
export const WALL_DOMAINS: readonly string[] = [
  "linkedin.com", "indeed.com", "glassdoor.com", "glassdoor.co.uk",
  "ziprecruiter.com", "upwork.com",
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
const TIER0_SOURCES = new Set(["adzuna", "jsearch"]);

export function sourceTrust(source: string): number {
  if (source.includes(":")) return 2;
  if (TIER0_SOURCES.has(source)) return 0;
  return 1;
}
