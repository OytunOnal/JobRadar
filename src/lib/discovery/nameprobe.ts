import { prisma } from "../db";
import { probeBoard } from "./validate";

// Harvest tier 4: name-guess probing. LinkedIn (and most aggregators) never
// expose the company's own site — but they give us the company NAME, and most
// companies use name-derived ATS slugs. So: slugify the name, probe our
// platforms, and verify the hit by comparing the API's returned company name
// (the gh:peak lesson — a live slug can belong to a different company).
//
// Only platforms whose probe returns a company name participate: a hit we
// can't verify is worse than no hit. Every attempt is cached forever in
// CompanyProbe — a name is probed once, ever.

// Platforms whose probe body carries a company name (see validate.ts).
const VERIFIABLE_PLATFORMS = ["greenhouse", "workable", "recruitee", "smartrecruiters", "personio"] as const;

// Legal suffixes carry no identity; product words (Games, Labs, Studio) DO —
// stripping "Games" would turn Dream Games into a different company.
const LEGAL_SUFFIX_RE =
  /\b(gmbh|inc|ltd|llc|ag|plc|corp|corporation|limited|b\.?v\.?|n\.?v\.?|s\.?a\.?|s\.?l\.?|s\.?a\.?s|sarl|a\/s|aps|ab|oy|kft|sp\.? z ?o\.?o\.?)\b\.?/gi;

export function normalizeCompanyName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // fold diacritics: Müller → Muller
    .toLowerCase()
    .replace(LEGAL_SUFFIX_RE, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// "Dream Games GmbH" → ["dreamgames", "dream-games"]. Too-short names ("EY")
// produce nothing — short slugs collide with unrelated companies too easily.
export function slugCandidates(name: string): string[] {
  const words = normalizeCompanyName(name).split(" ").filter(Boolean);
  if (words.length === 0) return [];
  const joined = words.join("");
  if (joined.length < 4) return [];
  const out = [joined];
  if (words.length > 1) out.push(words.join("-"));
  return out;
}

// Same company? Normalized equality or containment either way.
// "Peak Physical Therapy" vs "Peak Games" → no. "Azumo" vs "Azumo Inc" → yes.
export function namesMatch(a: string, b: string): boolean {
  const na = normalizeCompanyName(a).replace(/ /g, "");
  const nb = normalizeCompanyName(b).replace(/ /g, "");
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

export interface NameProbeHit {
  platform: string;
  token: string;
  companyName: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Greenhouse's validation probe hits the board ROOT (no job list), so the
// live-posting requirement needs one extra call for greenhouse hits only.
async function greenhouseJobCount(token: string): Promise<number> {
  try {
    const res = await fetch(`https://boards-api.greenhouse.io/v1/boards/${token}/jobs`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return 0;
    const data = await res.json();
    return Array.isArray(data?.jobs) ? data.jobs.length : 0;
  } catch {
    return 0;
  }
}

// Probe one company across the verifiable platforms; first VERIFIED hit wins.
export async function probeCompany(
  companyName: string,
  probeFn: typeof probeBoard = probeBoard,
): Promise<NameProbeHit | null> {
  const candidates = slugCandidates(companyName);
  for (const token of candidates) {
    for (const platform of VERIFIABLE_PLATFORMS) {
      const outcome = await probeFn(platform, token, "");
      await sleep(250);
      if (outcome.result !== "active" || !outcome.companyName) continue;
      if (!namesMatch(companyName, outcome.companyName)) continue; // gh:peak guard
      // Empty boards are squatted/trial accounts, not hiring channels
      // (measured: "workable:jpmorgan" answers with a name and 0 jobs).
      let jobCount = outcome.jobCount;
      if (jobCount === undefined && platform === "greenhouse") {
        jobCount = await greenhouseJobCount(token);
      }
      if (!jobCount || jobCount < 1) continue;
      return { platform, token, companyName: outcome.companyName };
    }
  }
  return null;
}

export interface NameProbeReport {
  checked: number;
  found: number;
}

// Probe up to `budget` new company names; hits land in AtsBoard as ACTIVE
// (we just probed them) and their whole board joins the next ingest.
export async function runNameProbes(
  companyNames: Iterable<string>,
  budget: number,
  probeFn: typeof probeBoard = probeBoard,
): Promise<NameProbeReport> {
  const report: NameProbeReport = { checked: 0, found: 0 };

  // Names our board table already covers need no probing. Matching is
  // namesMatch-loose, not exact: "Mistral" and "Mistral Ai" are the same
  // company (learned when tier 5 re-discovered a board we already had).
  const knownCollapsed = (await prisma.atsBoard.findMany({ select: { companyName: true } }))
    .map((b) => (b.companyName ? normalizeCompanyName(b.companyName).replace(/ /g, "") : ""))
    .filter((n) => n.length >= 4);
  const isKnown = (norm: string) => {
    const c = norm.replace(/ /g, "");
    if (c.length < 4) return false;
    return knownCollapsed.some((k) => k === c || k.includes(c) || c.includes(k));
  };

  const seen = new Set<string>();
  for (const raw of companyNames) {
    if (report.checked >= budget) break;
    const norm = normalizeCompanyName(raw);
    if (!norm || seen.has(norm) || isKnown(norm)) continue;
    seen.add(norm);
    if (slugCandidates(raw).length === 0) continue;
    const cached = await prisma.companyProbe.findUnique({ where: { name: norm } });
    if (cached) continue;

    report.checked++;
    const hit = await probeCompany(raw, probeFn);
    await prisma.companyProbe.create({ data: { name: norm, displayName: raw, found: hit !== null } });
    if (hit) {
      report.found++;
      await prisma.atsBoard.upsert({
        where: { platform_token_region: { platform: hit.platform, token: hit.token, region: "" } },
        update: {},
        create: {
          platform: hit.platform,
          token: hit.token,
          region: "",
          companyName: hit.companyName,
          status: "active", // we just probed it live
          discoveredVia: "name-probe",
          validatedAt: new Date(),
        },
      });
    }
  }
  return report;
}
