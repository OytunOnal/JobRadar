import { stripHtml, type RawJob, type Source } from "./types";

// Two small AI-flavored niche boards with keyless JSON APIs (found via
// career-ops' provider catalog). Both fit the profile's AI/game lean:
//
//   agentic-engineering-jobs.com  /api/v1/jobs — AI-agent engineering roles,
//     RICH payload: description, salary, visaSponsorship, locationType.
//   speedrun-talent-network.com   /api/v1/jobs — a16z SPEEDRUN portfolio
//     (games/AI startups); payload { jobs: [...] } with comp + workplace.
//
// Config: NICHE_MAX_PAGES (2, x50/page each)

const UA = "JobRadar/0.1 (personal job search)";
const MAX_PAGES = Number(process.env.NICHE_MAX_PAGES) || 2;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

// ── agentic-engineering-jobs.com ─────────────────────────────────────────────

export function mapAgentic(j: any): RawJob | null {
  const title = String(j?.title ?? "").trim();
  const slug = String(j?.slug ?? "").trim();
  if (!title || !/^[A-Za-z0-9_-]+$/.test(slug)) return null;
  const locType = String(j.locationType ?? "").toLowerCase();
  const salary = j.salaryMin
    ? `${j.salaryMin}–${j.salaryMax ?? j.salaryMin} ${j.salaryCurrency ?? ""}`.trim()
    : undefined;
  const visa = j.visaSponsorship === true ? "yes" as const : undefined;
  return {
    source: "agenticjobs",
    externalId: slug,
    url: `https://agentic-engineering-jobs.com/jobs/${slug}`,
    title,
    company: String(j.companyName ?? "").trim(),
    location: String(j.location ?? j.city ?? "").trim() || undefined,
    remote: locType === "remote",
    workMode: locType === "remote" || locType === "hybrid" || locType === "onsite" ? (locType as any) : undefined,
    salaryText: salary,
    description: stripHtml(String(j.description ?? "")) || title,
    postedAt: j.postedAt && !Number.isNaN(Date.parse(j.postedAt)) ? new Date(j.postedAt) : undefined,
    visa,
  };
}

export async function fetchAgentic(fetchImpl: typeof fetch = fetch): Promise<RawJob[]> {
  const out: RawJob[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= MAX_PAGES; page++) {
    const data = await getJson(`https://agentic-engineering-jobs.com/api/v1/jobs?page=${page}`, fetchImpl);
    const rows: any[] = data?.data ?? [];
    for (const j of rows) {
      const job = mapAgentic(j);
      if (!job || seen.has(job.externalId)) continue;
      seen.add(job.externalId);
      out.push(job);
    }
    if (rows.length === 0) break;
    await sleep(400);
  }
  return out;
}

// ── a16z SPEEDRUN talent network ─────────────────────────────────────────────

export function mapSpeedrun(j: any): RawJob | null {
  const title = String(j?.title ?? "").trim();
  const url = typeof j?.url === "string" && j.url.startsWith("https://") ? j.url : "";
  if (!title || !url) return null;
  const workplace = String(j.workplace_type ?? "").toLowerCase();
  const salary = j.comp_min
    ? `${j.comp_min}–${j.comp_max ?? j.comp_min} ${j.comp_currency ?? ""}/${j.comp_period ?? "year"}`.trim()
    : undefined;
  return {
    source: "a16z-speedrun",
    externalId: String(j.id ?? url),
    url,
    title,
    company: String(j.company ?? j.company_slug ?? "").trim() || "SPEEDRUN portfolio (stealth)",
    location: String(j.location ?? "").trim() || undefined,
    remote: Boolean(j.remote) || workplace === "remote",
    workMode: workplace === "remote" || workplace === "hybrid" || workplace === "onsite" ? (workplace as any) : undefined,
    salaryText: salary,
    description: [title, j.function, j.seniority].filter(Boolean).join(" · "),
    postedAt: j.published_at && !Number.isNaN(Date.parse(j.published_at)) ? new Date(j.published_at) : undefined,
  };
}

export async function fetchSpeedrun(fetchImpl: typeof fetch = fetch): Promise<RawJob[]> {
  const out: RawJob[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= MAX_PAGES; page++) {
    const data = await getJson(`https://speedrun-talent-network.com/api/v1/jobs?page=${page}`, fetchImpl);
    const rows: any[] = data?.jobs ?? [];
    for (const j of rows) {
      const job = mapSpeedrun(j);
      if (!job || seen.has(job.externalId)) continue;
      seen.add(job.externalId);
      out.push(job);
    }
    const totalPages = Number(data?.total_pages ?? 1);
    if (rows.length === 0 || page >= totalPages) break;
    await sleep(400);
  }
  return out;
}

export const agenticjobs: Source = { name: "agenticjobs", fetch: () => fetchAgentic() };
export const a16zspeedrun: Source = { name: "a16z-speedrun", fetch: () => fetchSpeedrun() };
