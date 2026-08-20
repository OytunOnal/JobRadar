import { profileSearchGroups } from "../profile";
import { stripHtml, type RawJob, type Source } from "./types";

// freehire.me — open-source job aggregator with a keyless public JSON API that
// normalizes postings from ~50 ATS platforms into one schema. Unlike the
// classic aggregators, its `url` field is the REAL posting URL on the
// employer's ATS host — so links are first-party and every stored job also
// feeds the harvest tier with a fresh ATS URL to mine.
//
// The agent search variant returns full descriptions inline, so a search is
// one request — no per-job detail fetches. Facets are ANDed across, ORed
// within: one request per title covers all our countries at once.
//
// Config:
//   FREEHIRE_COUNTRIES  comma-sep ISO codes, default "de,nl,es,pt,fr"
//   FREEHIRE_WINDOW_DAYS (7)   FREEHIRE_LIMIT (50/search)
//   FREEHIRE_API_URL    self-hosted instance override
//
// The public instance is community-run and sometimes slow or 504ing under
// load — requests retry 429/5xx briefly, then the source degrades gracefully.

const BASE = () => process.env.FREEHIRE_API_URL || "https://freehire.me";
const UA = "JobRadar/0.1 (personal job search)";
const WINDOW_DAYS = Number(process.env.FREEHIRE_WINDOW_DAYS) || 7;
const LIMIT = Number(process.env.FREEHIRE_LIMIT) || 50;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function countries(): string[] {
  return (process.env.FREEHIRE_COUNTRIES || "de,nl,es,pt,fr")
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

export function buildSearchUrl(query: string, opts: { remote?: boolean } = {}): string {
  const p = new URLSearchParams();
  p.set("q", query);
  p.set("limit", String(LIMIT));
  p.set("offset", "0");
  p.set("semantic_ratio", "0"); // keyword search; the semantic index is opt-in
  p.set("include_description", "true");
  p.set("description_format", "text");
  p.set("posted_within_days", String(WINDOW_DAYS));
  if (opts.remote) {
    p.set("work_mode", "remote");
    p.append("regions", "eu");
  } else {
    for (const c of countries()) p.append("countries", c);
  }
  return `${BASE()}/api/v1/agent/jobs/search?${p.toString()}`;
}

async function apiGet(url: string, fetchImpl: typeof fetch): Promise<any | null> {
  let delay = 1000;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetchImpl(url, {
        headers: { "User-Agent": UA, Accept: "application/json" },
        signal: AbortSignal.timeout(45_000), // the search index can be slow
      });
      if (res.status === 429 || res.status >= 500) {
        await sleep(delay);
        delay *= 2;
        continue;
      }
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null; // unreachable — degrade now, not after retries
    }
  }
  return null;
}

// The documented job object → RawJob. `url` is the employer's ATS posting.
export function mapJob(j: any): RawJob | null {
  if (!j?.public_slug || !j?.url || !j?.title) return null;
  const enrich = j.enrichment ?? {};
  const salary =
    enrich.salary_min != null
      ? `${enrich.salary_min}–${enrich.salary_max ?? enrich.salary_min} ${enrich.salary_currency ?? ""}`.trim()
      : undefined;
  const workMode =
    j.work_mode === "remote" || j.work_mode === "hybrid" || j.work_mode === "onsite"
      ? j.work_mode
      : undefined;
  return {
    source: "freehire",
    externalId: String(j.public_slug),
    url: String(j.url),
    title: stripHtml(String(j.title)),
    company: String(j.company ?? j.company_slug ?? ""),
    location: j.location ? String(j.location) : undefined,
    remote: workMode === "remote",
    workMode,
    salaryText: salary,
    description: stripHtml(String(j.description ?? "")),
    postedAt: j.posted_at ? new Date(j.posted_at) : undefined,
  };
}

export async function fetchFreehire(fetchImpl: typeof fetch = fetch): Promise<RawJob[]> {
  const out: RawJob[] = [];
  const seen = new Set<string>();
  const queries = profileSearchGroups(4).map((g) => g.en[0]);
  let consecutiveFailures = 0;
  for (const q of queries) {
    // Country pass (onsite/hybrid/remote within our countries) + EU-remote pass.
    for (const remote of [false, true]) {
      // Circuit breaker: two searches down in a row = the instance is down
      // today; stop grinding retry-backoff on the rest.
      if (consecutiveFailures >= 2) return out;
      const data = await apiGet(buildSearchUrl(q, { remote }), fetchImpl);
      consecutiveFailures = data ? 0 : consecutiveFailures + 1;
      for (const j of data?.data ?? []) {
        const job = mapJob(j);
        if (!job || seen.has(job.externalId)) continue;
        seen.add(job.externalId);
        out.push(job);
      }
      await sleep(500);
    }
  }
  return out;
}

export const freehire: Source = {
  name: "freehire",
  fetch: () => fetchFreehire(),
};
