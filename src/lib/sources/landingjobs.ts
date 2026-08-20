import { stripHtml, type RawJob, type Source } from "./types";

// Landing.Jobs — Portugal-centric European tech board with a relocation
// focus. Keyless JSON API. Pagination is OFFSET-based: `page` and `sort` are
// ignored server-side, `limit` caps at 50, but `offset` works (verified
// live: offset=50 returns disjoint ids). We walk offsets until a short page.
// Old-but-open postings are filtered by ingest's own age guard.
// relocation_paid is the board's own flag → structured visa signal.
//
// Config: LANDINGJOBS_MAX_PAGES (10, x50/page)

const API_URL = "https://landing.jobs/api/v1/jobs";
const UA = "JobRadar/0.1 (personal job search)";
const LIMIT = 50; // server cap; larger values are clamped to 50
const MAX_PAGES = Number(process.env.LANDINGJOBS_MAX_PAGES) || 10;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function mapJob(j: any): RawJob | null {
  if (!j?.id || !j?.title || !j?.url) return null;
  // The API carries no company field; the job URL path does: /at/<company>/…
  const companySlug = /\/at\/([^/]+)\//.exec(String(j.url))?.[1] ?? "";
  const company = companySlug.replace(/-/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase());
  const locations = Array.isArray(j.locations)
    ? j.locations.map((l: any) => (typeof l === "string" ? l : [l?.city, l?.country_code?.toUpperCase()].filter(Boolean).join(", "))).filter(Boolean)
    : [];
  const salary =
    j.gross_salary_low != null
      ? `${j.gross_salary_low}–${j.gross_salary_high ?? j.gross_salary_low} ${j.currency_code ?? ""}`.trim()
      : undefined;
  const description = stripHtml(
    [j.role_description, j.main_requirements, j.nice_to_have, j.perks].filter(Boolean).join("\n"),
  );
  return {
    source: "landingjobs",
    externalId: String(j.id),
    url: String(j.url),
    title: String(j.title),
    company,
    location: locations.join("; ") || "Portugal",
    remote: Boolean(j.remote),
    salaryText: salary,
    description,
    postedAt: j.published_at ? new Date(j.published_at) : undefined,
    // The board's own relocation flag; false is "not offered", not a refusal.
    visa: j.relocation_paid === true ? "yes" : undefined,
  };
}

export async function fetchLandingjobs(fetchImpl: typeof fetch = fetch): Promise<RawJob[]> {
  const out: RawJob[] = [];
  const seen = new Set<string>();
  for (let page = 0; page < MAX_PAGES; page++) {
    let data: any;
    try {
      const res = await fetchImpl(`${API_URL}?limit=${LIMIT}&offset=${page * LIMIT}`, {
        headers: { "User-Agent": UA, Accept: "application/json" },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) break; // partial result beats none
      data = await res.json();
    } catch {
      break;
    }
    const items: any[] = Array.isArray(data) ? data : [];
    for (const item of items) {
      const job = mapJob(item);
      if (!job || seen.has(job.externalId)) continue;
      seen.add(job.externalId);
      out.push(job);
    }
    if (items.length < LIMIT) break; // short page = done
    await sleep(300);
  }
  return out;
}

export const landingjobs: Source = {
  name: "landingjobs",
  fetch: () => fetchLandingjobs(),
};
