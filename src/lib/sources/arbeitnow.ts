import { stripHtml, type RawJob, type Source } from "./types";

// Arbeitnow: EU-focused board, clean JSON, newest-first, ~100 jobs per page
// with cursor pagination via links.next. One page misses part of a busy week,
// so we follow the cursor until the feed ages past the ingest window.
// https://www.arbeitnow.com/api/job-board-api
//
// Stop conditions, in order: feed older than the window (the normal exit),
// no next link, or the page cap (a safety net against a broken/looping
// cursor — never the expected exit at weekly volumes).
//
// Config: ARBEITNOW_WINDOW_DAYS (7)  ARBEITNOW_MAX_PAGES (20)

const API_URL = "https://www.arbeitnow.com/api/job-board-api";
const UA = "JobRadar/0.1 (personal job search)";
const WINDOW_DAYS = Number(process.env.ARBEITNOW_WINDOW_DAYS) || 7;
const MAX_PAGES = Number(process.env.ARBEITNOW_MAX_PAGES) || 20;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function mapItem(j: any): RawJob | null {
  if (!j?.slug || !j?.url || !j?.title) return null;
  return {
    source: "arbeitnow",
    externalId: String(j.slug),
    url: String(j.url),
    title: String(j.title),
    company: String(j.company_name ?? ""),
    location: String(j.location ?? ""),
    remote: Boolean(j.remote),
    description: stripHtml(j.description),
    postedAt: j.created_at ? new Date(j.created_at * 1000) : undefined, // unix seconds
  };
}

export async function fetchArbeitnow(fetchImpl: typeof fetch = fetch): Promise<RawJob[]> {
  const cutoff = Date.now() - WINDOW_DAYS * 86_400_000;
  const out: RawJob[] = [];
  const seen = new Set<string>();

  let url: string | null = API_URL;
  for (let page = 0; url && page < MAX_PAGES; page++) {
    let data: any;
    try {
      const res = await fetchImpl(url, {
        headers: { "User-Agent": UA, Accept: "application/json" },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) break; // partial result beats none
      data = await res.json();
    } catch {
      break;
    }

    let pageOldest = Infinity;
    for (const item of data?.data ?? []) {
      const job = mapItem(item);
      if (!job || seen.has(job.externalId)) continue;
      seen.add(job.externalId);
      const t = job.postedAt?.getTime();
      if (t !== undefined) pageOldest = Math.min(pageOldest, t);
      // Undated jobs are kept — ingest's own age guard is the backstop.
      if (t !== undefined && t < cutoff) continue;
      out.push(job);
    }

    // Newest-first feed: once a page's oldest job predates the window, every
    // later page is older still.
    if (pageOldest < cutoff) break;
    url = typeof data?.links?.next === "string" && data.links.next ? data.links.next : null;
    if (url) await sleep(300);
  }
  return out;
}

export const arbeitnow: Source = {
  name: "arbeitnow",
  fetch: () => fetchArbeitnow(),
};
