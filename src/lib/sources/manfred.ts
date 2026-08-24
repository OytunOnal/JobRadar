import { scoreJob } from "../score";
import { labelledSections } from "../sections";
import { type RawJob, type Source } from "./types";

// Manfred — Spanish tech job platform with a genuinely open public API:
// every ACTIVE offer with salary range, remote percentage, and locations in
// one request (~1.6k offers). The list carries no description body, so this
// is two-stage: the free title score gates which offers get a detail call
// (introduction / responsibilities / requirements / tech stack).
//
// Config: MANFRED_DETAIL_MAX (40)

const LIST_URL = "https://www.getmanfred.com/api/v2/public/offers?lang=EN";
const DETAIL_URL = "https://www.getmanfred.com/api/v2/public/offers";
const UA = "JobRadar/0.1 (personal job search)";
const DETAIL_MAX = Number(process.env.MANFRED_DETAIL_MAX) || 40;
// Mirrors ingest's STORE_THRESHOLD (importing it would be circular).
const SCORE_GATE = 20;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function mapOffer(o: any, description = ""): RawJob | null {
  if (!o?.id || !o?.position || o?.status !== "ACTIVE") return null;
  const salary =
    o.salaryTo ? `${o.salaryFrom || "?"}–${o.salaryTo} ${o.currency ?? "€"}` : undefined;
  const pct = Number(o.remotePercentage ?? 0);
  const workMode = pct >= 100 ? "remote" : pct > 0 ? "hybrid" : "onsite";
  const locations = Array.isArray(o.locations) ? o.locations.filter(Boolean).join("; ") : "";
  return {
    source: "manfred",
    externalId: String(o.id),
    url: `https://www.getmanfred.com/en/job-offers/${o.id}/${o.slug ?? ""}`,
    title: String(o.position),
    company: String(o.company?.name ?? ""),
    location: locations || "Spain",
    remote: workMode === "remote",
    workMode,
    salaryText: salary,
    description,
    postedAt: o.updatedAt ? new Date(o.updatedAt) : undefined,
  };
}

// Detail sections → one readable description.
export function detailToText(d: any): string {
  // Manfred names every block; keep the names so the section parser reads
  // them as headings instead of guessing from one run-on wall of text.
  const flatten = (v: unknown) =>
    Array.isArray(v) ? v.filter((x) => typeof x === "string").join("\n") : v;
  return labelledSections([
    ["", flatten(d?.introduction)],
    ["Responsibilities", flatten(d?.whatWillYouDo)],
    ["Requirements", flatten(d?.whatTheyAskFor)],
    ["Responsibilities", flatten(d?.responsibilities)],
    ["Tech stack", Array.isArray(d?.techs) ? d.techs.map((t: any) => t?.name ?? t).join(", ") : ""],
  ]).slice(0, 8000);
}

async function getJson(url: string, fetchImpl: typeof fetch): Promise<any | null> {
  try {
    const res = await fetchImpl(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function fetchManfred(fetchImpl: typeof fetch = fetch): Promise<RawJob[]> {
  const list = await getJson(LIST_URL, fetchImpl);
  if (!Array.isArray(list)) return [];

  // Detail budget goes to the best title scores first (two-stage cost model).
  const scored = list
    .map((o) => ({ o, job: mapOffer(o) }))
    .filter((x): x is { o: any; job: RawJob } => x.job !== null)
    .map(({ o, job }) => ({ o, job, score: scoreJob(job) }))
    .filter(({ score }) => !score.disqualified && score.score >= SCORE_GATE)
    .sort((a, b) => b.score.score - a.score.score);

  const out: RawJob[] = [];
  for (const { o, job } of scored.slice(0, DETAIL_MAX)) {
    const detail = await getJson(`${DETAIL_URL}/${o.id}?lang=EN`, fetchImpl);
    out.push(detail ? { ...job, description: detailToText(detail) } : job);
    await sleep(300);
  }
  return out;
}

export const manfred: Source = {
  name: "manfred",
  fetch: () => fetchManfred(),
};
