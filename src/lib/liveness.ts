import { prisma } from "./db";
import { isWallJobUrl } from "./domains";

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
// Config: LIVENESS_MAX (40/run)  LIVENESS_MIN_AGE_DAYS (10)

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
  /this (?:job|posting|position) has (?:expired|closed|been closed|been removed)/i,
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
}

export async function runLivenessSweep(
  budget = LIVENESS_MAX,
  fetchImpl: typeof fetch = fetch,
): Promise<LivenessReport> {
  const report: LivenessReport = { checked: 0, expired: 0, refreshed: 0 };
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
