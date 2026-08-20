import { profileSearchGroups } from "../profile";
import { stripHtml, type RawJob, type Source } from "./types";

// Working Nomads — remote-jobs board whose site search is a public
// Elasticsearch endpoint (jobsapi/_search): full query DSL, full descriptions,
// salary strings, apply URLs. One query_string search per profile lead title,
// newest first, window-filtered client-side.
//
// Config: WN_WINDOW_DAYS (7)  WN_SIZE (100/query)

const SEARCH_URL = "https://www.workingnomads.com/jobsapi/_search";
const UA = "JobRadar/0.1 (personal job search)";
const WINDOW_DAYS = Number(process.env.WN_WINDOW_DAYS) || 7;
const SIZE = Number(process.env.WN_SIZE) || 100;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function buildQuery(title: string): object {
  return {
    size: SIZE,
    sort: [{ pub_date: { order: "desc" } }],
    query: {
      bool: {
        must: [{ query_string: { query: title, fields: ["title^2", "description", "company"] } }],
        must_not: [{ term: { expired: true } }],
      },
    },
    min_score: 2,
  };
}

export function mapHit(s: any): RawJob | null {
  const title = String(s?.title ?? "").trim();
  const slug = String(s?.slug ?? "").trim();
  if (!title || !slug) return null;
  return {
    source: "workingnomads",
    externalId: String(s.id ?? slug),
    url: typeof s.apply_url === "string" && s.apply_url.startsWith("http")
      ? s.apply_url
      : `https://www.workingnomads.com/jobs/${slug}`,
    title,
    company: String(s.company ?? "").trim(),
    location: String(s.location_base ?? s.locations ?? "Remote") || "Remote",
    remote: true, // remote-only board
    workMode: "remote",
    salaryText: s.salary_range ? String(s.salary_range) : undefined,
    description: stripHtml(String(s.description ?? "")),
    postedAt: s.pub_date && !Number.isNaN(Date.parse(s.pub_date)) ? new Date(s.pub_date) : undefined,
  };
}

export async function fetchWorkingNomads(fetchImpl: typeof fetch = fetch): Promise<RawJob[]> {
  const cutoff = Date.now() - WINDOW_DAYS * 86_400_000;
  const out: RawJob[] = [];
  const seen = new Set<string>();
  for (const g of profileSearchGroups(4)) {
    let data: any;
    try {
      const res = await fetchImpl(SEARCH_URL, {
        method: "POST",
        headers: { "User-Agent": UA, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(buildQuery(g.en[0])),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) continue;
      data = await res.json();
    } catch {
      continue;
    }
    for (const hit of data?.hits?.hits ?? []) {
      const job = mapHit(hit?._source);
      if (!job || seen.has(job.externalId)) continue;
      seen.add(job.externalId);
      const t = job.postedAt?.getTime();
      if (t !== undefined && t < cutoff) continue;
      out.push(job);
    }
    await sleep(300);
  }
  return out;
}

export const workingnomads: Source = {
  name: "workingnomads",
  fetch: () => fetchWorkingNomads(),
};
