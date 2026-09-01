import { prisma } from "./db";
import { isWallJobUrl } from "./domains";
import { atsFetchers, type AtsProvider } from "./sources/ats";

// Liveness probing for aggregator-sourced jobs. The delist sweep diffs a
// direct source's feed against its stored rows — but jobs from LinkedIn, HN,
// EURES, freehire etc. have no diffable feed, so a closed role would sit
// "fresh" forever. This pass probes the posting URL of AGING aggregator jobs
// and reads the page for closure banners.
//
// Design points (several learned from career-ops' liveness-core):
//   - Portals write closure banners with TYPOGRAPHIC punctuation — WTTJ says
//     "n’est plus disponible" with U+2019. Normalize before matching, or the
//     pattern silently never fires.
//   - 404/410 is expired; everything else needs page evidence. A 200 with no
//     banner stays "uncertain" — never delist on uncertainty.
//   - A confirmed-active job gets its lastSeenAt refreshed ("still listed at
//     the source"), which also keeps it out of the next sweep's window.
//   - Wall domains (login-gated) are skipped — a wall says nothing.
//
// Direct-source jobs (source "ashby:x") have a SECOND lane: their board's
// feed is re-fetched and diffed — one request sweeps the whole board. This
// closes the gap where a posting dies between board rotations (live case:
// an ashby job 404'd ~18h after its board's last fetch and sat visible).
//
// Config: LIVENESS_MAX (40/run)  LIVENESS_MIN_AGE_DAYS (10)
//         LIVENESS_BOARDS (15/run)  LIVENESS_BOARD_AGE_DAYS (2)

const UA = "Mozilla/5.0 (compatible; JobRadar/0.1; personal job search)";
const LIVENESS_MAX = Number(process.env.LIVENESS_MAX) || 40;
const MIN_AGE_DAYS = Number(process.env.LIVENESS_MIN_AGE_DAYS) || 10;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ASCII-fold quotes/diacritics and collapse whitespace so every pattern below
// can be spelled in one normalized alphabet.
export function normalizeForMatch(text: string): string {
  return text
    .replace(/[‘’ʼ′´`]/g, "'")
    .replace(/[“”″]/g, '"')
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ");
}

// Closure banners across our markets' languages. Spelled in the normalized
// alphabet (ASCII apostrophes, no diacritics).
const EXPIRED_PATTERNS: RegExp[] = [
  // English
  /\bjob (is )?no longer (available|open|active)\b/i,
  /no longer accepting applications/i,
  /\b(?:position|role|posting|opening|vacancy|requisition)\b[\s\S]{0,60}?has been filled\b(?!\s+out)/i,
  // One noun or two: Arbeitnow says "this JOB POSITION has been removed", and
  // the single-word version read that page as live. A closure banner names the
  // thing however it likes.
  /this (?:(?:job|posting|position|listing|vacancy|opening)\s+){1,2}has (?:expired|closed|been closed|been removed|been taken down)/i,
  /\bjob (?:posting )?(?:has )?expired\b/i,
  /posting (?:is )?(?:closed|inactive|not found)/i,
  // German
  /stellenanzeige ist (?:nicht mehr|leider nicht mehr) (?:verfugbar|aktiv|online)/i,
  /stelle (?:ist |wurde )?(?:bereits |inzwischen )?besetzt/i,
  /anzeige ist abgelaufen/i,
  // Dutch
  /vacature is (?:niet meer|helaas niet meer) beschikbaar/i,
  /vacature is (?:vervuld|verlopen|gesloten)/i,
  // French
  /offre n'est plus (?:disponible|en ligne)/i,
  /offre a (?:ete )?pourvue/i,
  /cette offre (?:d'emploi )?(?:a expire|est expiree|est cloturee)/i,
  // Spanish / Portuguese
  /oferta ya no esta disponible/i,
  /oferta (?:ha )?(?:expirado|caducado|finalizado)/i,
  /(?:vaga|oferta) (?:ja )?nao esta (?:mais )?disponivel/i,
  // Danish (jobnet.dk serves its not-found as a 200 page: "Vi beklager, men
  // siden eksisterer ikke"). Diacritics are normalized away upstream, so
  // "udløbet" is matched loosely.
  /siden eksisterer ikke/i,
  /annoncen er udl.bet/i,
  /stillingen er (?:besat|nedlagt)/i,
  /jobbet er ikke l.ngere tilg.ngeligt/i,
  // Swedish
  /annonsen (?:ar|er) inte l.ngre tillg.nglig/i,
  /tj.nsten (?:ar|er) tillsatt/i,
];

export type Liveness = "expired" | "active" | "uncertain";

export function classifyLiveness(status: number, html: string): Liveness {
  if (status === 404 || status === 410) return "expired";
  if (status !== 200) return "uncertain"; // walls, 5xx, redirect loops: no verdict
  const text = normalizeForMatch(html);
  for (const re of EXPIRED_PATTERNS) {
    if (re.test(text)) return "expired";
  }
  // A 200 page that still shows the posting: treat as listed. We can't prove
  // the apply flow works, but the honest default for a visible posting is
  // active, not expired.
  return "active";
}

export interface LivenessReport {
  checked: number;
  expired: number;
  refreshed: number;
  boardsRefreshed: number;
}

// Job.source prefix → ats fetcher id (greenhouse writes "gh:", SmartRecruiters
// "sr:"; the rest match their fetcher names).
export const SOURCE_PREFIX_TO_FETCHER: Record<string, AtsProvider> = {
  gh: "greenhouse", sr: "smartrecruiters",
  lever: "lever", ashby: "ashby", workable: "workable", recruitee: "recruitee",
  personio: "personio", workday: "workday", teamtailor: "teamtailor",
  bamboohr: "bamboohr", breezy: "breezy", join: "join", pinpoint: "pinpoint",
};

const BOARDS_MAX = Number(process.env.LIVENESS_BOARDS) || 15;
const BOARD_AGE_DAYS = Number(process.env.LIVENESS_BOARD_AGE_DAYS) || 2;

// Lane 2: refresh the stalest direct-source boards and diff their feeds.
async function refreshStaleBoards(report: LivenessReport): Promise<void> {
  const cutoff = new Date(Date.now() - BOARD_AGE_DAYS * 86_400_000);
  const stale = await prisma.job.groupBy({
    by: ["source"],
    where: { delistedAt: null, source: { contains: ":" }, lastSeenAt: { lt: cutoff } },
    _min: { lastSeenAt: true },
  });
  const boards = stale
    .sort((a, b) => (a._min.lastSeenAt?.getTime() ?? 0) - (b._min.lastSeenAt?.getTime() ?? 0))
    .slice(0, BOARDS_MAX);

  for (const b of boards) {
    const [prefix, ...restTok] = b.source.split(":");
    const fetcherId = SOURCE_PREFIX_TO_FETCHER[prefix];
    const token = restTok.join(":");
    if (!fetcherId || !token) continue;
    // Fetcher ids equal platform ids across the registry.
    const boardRow = await prisma.atsBoard.findFirst({
      where: { platform: fetcherId, token },
      select: { region: true, companyName: true },
    });
    let live;
    try {
      live = await atsFetchers[fetcherId](token, boardRow?.companyName ?? token, boardRow?.region ?? "");
    } catch {
      continue; // a failing feed proves nothing — leave the jobs alone
    }
    report.boardsRefreshed++;
    const liveIds = new Set(live.map((j) => j.externalId));
    const stored = await prisma.job.findMany({
      where: { source: b.source, delistedAt: null },
      select: { id: true, externalId: true },
    });
    for (const row of stored) {
      if (liveIds.has(row.externalId)) {
        await prisma.job.update({ where: { id: row.id }, data: { lastSeenAt: new Date() } });
        report.refreshed++;
      } else {
        await prisma.job.update({ where: { id: row.id }, data: { delistedAt: new Date() } });
        report.expired++;
      }
    }
    await sleep(400);
  }
}

export async function runLivenessSweep(
  budget = LIVENESS_MAX,
  fetchImpl: typeof fetch = fetch,
): Promise<LivenessReport> {
  const report: LivenessReport = { checked: 0, expired: 0, refreshed: 0, boardsRefreshed: 0 };
  await refreshStaleBoards(report);
  const cutoff = new Date(Date.now() - MIN_AGE_DAYS * 86_400_000);
  // Aggregator jobs only (direct sources have the feed-diff sweep), stalest
  // lastSeenAt first — those have gone longest without any listing evidence.
  const rows = await prisma.job.findMany({
    where: {
      delistedAt: null,
      lastSeenAt: { lt: cutoff },
      NOT: { source: { contains: ":" } },
    },
    orderBy: { lastSeenAt: "asc" },
    take: budget * 2, // headroom for walled URLs we skip below
    select: { id: true, url: true },
  });

  for (const row of rows) {
    if (report.checked >= budget) break;
    if (!row.url || isWallJobUrl(row.url)) continue;
    report.checked++;
    let verdict: Liveness = "uncertain";
    try {
      const res = await fetchImpl(row.url, {
        headers: { "User-Agent": UA, Accept: "text/html" },
        signal: AbortSignal.timeout(15_000),
        redirect: "follow",
      });
      const html = res.status === 200 ? (await res.text()).slice(0, 400_000) : "";
      verdict = classifyLiveness(res.status, html);
    } catch {
      verdict = "uncertain"; // network trouble is not closure evidence
    }
    if (verdict === "expired") {
      await prisma.job.update({ where: { id: row.id }, data: { delistedAt: new Date() } });
      report.expired++;
    } else if (verdict === "active") {
      await prisma.job.update({ where: { id: row.id }, data: { lastSeenAt: new Date() } });
      report.refreshed++;
    }
    await sleep(500);
  }
  return report;
}
