import { prisma } from "../db";
import { atsFetchers } from "../sources/ats";
import { companies } from "../sources/companies";
import type { Source } from "../sources/types";
import { getPlatform } from "./platforms";
import { titleizeToken } from "./validate";

// Pool integration: turns validated AtsBoard rows into ingest Sources, so the
// dashboard is fed by discovered companies' OFFICIAL boards — not only the
// hand-curated list in companies.ts.
//
// The curated list stays a separate, always-fetched seed layer; boards that
// duplicate it are excluded here so no company is fetched twice.

// Curated (platform, token) pairs — companies.ts provider ids match registry
// platform ids by construction.
export function curatedKeys(): Set<string> {
  return new Set(companies.map((c) => `${c.provider}:${c.token.toLowerCase()}`));
}

// A board is due when it was never fetched, or its fetchIntervalDays have
// passed. hitRate-based interval stretching (a later step) will raise
// fetchIntervalDays on boards that never match; this predicate already honors it.
export function isDue(
  lastFetchedAt: Date | null,
  fetchIntervalDays: number,
  now: Date = new Date(),
): boolean {
  if (!lastFetchedAt) return true;
  return now.getTime() - lastFetchedAt.getTime() >= fetchIntervalDays * 86_400_000;
}

const DEFAULT_MAX_BOARDS = Number(process.env.DISCOVERY_MAX_BOARDS) || 200;

export async function boardSources(limit = DEFAULT_MAX_BOARDS): Promise<Source[]> {
  const curated = curatedKeys();
  // Stalest-first so a big backlog rotates fairly across ingest runs
  // (SQLite sorts NULLs first on ASC — never-fetched boards lead the queue).
  const boards = await prisma.atsBoard.findMany({
    where: { status: "active" },
    orderBy: { lastFetchedAt: "asc" },
  });

  const now = new Date();
  const out: Source[] = [];
  for (const b of boards) {
    if (out.length >= limit) break;
    const platform = getPlatform(b.platform);
    const fetcherId = platform?.fetcher;
    if (!fetcherId) continue; // discover-and-park platform — no fetcher yet
    if (curated.has(`${b.platform}:${b.token.toLowerCase()}`)) continue;
    if (!isDue(b.lastFetchedAt, b.fetchIntervalDays, now)) continue;

    const company = b.companyName ?? titleizeToken(b.token);
    out.push({
      name: `board:${b.platform}:${b.token}${b.region ? `@${b.region}` : ""}`,
      fetch: async () => {
        const jobs = await atsFetchers[fetcherId](b.token, company, b.region);
        await prisma.atsBoard.update({
          where: { id: b.id },
          data: { lastFetchedAt: new Date() },
        });
        return jobs;
      },
    });
  }
  return out;
}

// Bring the hand-curated list under the discovery layer's supervision: each
// entry becomes an AtsBoard row (discoveredVia "seed") so validation probes it
// like everything else. This is what systematically surfaces stale or wrong
// tokens in companies.ts (the gh:peak case — the token belongs to a physical
// therapy company, not Peak Games).
export async function seedCuratedBoards(): Promise<number> {
  let created = 0;
  for (const c of companies) {
    const region = c.region ?? "";
    const existing = await prisma.atsBoard.findUnique({
      where: { platform_token_region: { platform: c.provider, token: c.token.toLowerCase(), region } },
    });
    if (existing) continue;
    await prisma.atsBoard.create({
      data: {
        platform: c.provider,
        token: c.token.toLowerCase(),
        region,
        companyName: c.name,
        status: "candidate",
        discoveredVia: "seed",
      },
    });
    created++;
  }
  return created;
}
