import { getJSON, stripHtml, type RawJob, type Source } from "./types";

// Himalayas: remote jobs, no key, salary + location-restriction data. The API
// is offset-paginated over a ~100k-job archive (newest first), so a single
// page misses most of a week — we page until the feed ages past the window.
// https://himalayas.app/jobs/api
//
// Config: HIMALAYAS_WINDOW_DAYS (7)  HIMALAYAS_MAX_PAGES (10)

const WINDOW_DAYS = Number(process.env.HIMALAYAS_WINDOW_DAYS) || 7;
const MAX_PAGES = Number(process.env.HIMALAYAS_MAX_PAGES) || 10;
const LIMIT = 100;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function mapItem(j: any): RawJob | null {
  if (!j?.guid || !j?.title) return null;
  const salary =
    j.minSalary && j.maxSalary
      ? `${j.currency ?? ""}${j.minSalary}-${j.maxSalary}/${j.salaryPeriod ?? ""}`
      : undefined;
  const loc = Array.isArray(j.locationRestrictions) ? j.locationRestrictions.join(", ") : "";
  return {
    source: "himalayas",
    externalId: String(j.guid),
    url: j.applicationLink || j.guid,
    title: String(j.title),
    company: String(j.companyName ?? ""),
    location: loc || "Remote",
    remote: true,
    salaryText: salary,
    description: stripHtml(j.description || j.excerpt),
    postedAt: j.pubDate ? new Date(j.pubDate * 1000) : undefined, // unix seconds
  };
}

export async function fetchHimalayas(getJson: typeof getJSON = getJSON): Promise<RawJob[]> {
  const cutoff = Date.now() - WINDOW_DAYS * 86_400_000;
  const out: RawJob[] = [];
  const seen = new Set<string>();

  for (let page = 0; page < MAX_PAGES; page++) {
    let data: any;
    try {
      data = await getJson(`https://himalayas.app/jobs/api?limit=${LIMIT}&offset=${page * LIMIT}`);
    } catch {
      break; // partial result beats none
    }
    const jobs: any[] = data?.jobs ?? [];
    if (jobs.length === 0) break;

    let pageOldest = Infinity;
    for (const item of jobs) {
      const job = mapItem(item);
      if (!job || seen.has(job.externalId)) continue;
      seen.add(job.externalId);
      const t = job.postedAt?.getTime();
      if (t !== undefined) pageOldest = Math.min(pageOldest, t);
      if (t !== undefined && t < cutoff) continue;
      out.push(job);
    }
    // Newest-first: past the window means every later page is older still.
    if (pageOldest < cutoff) break;
    await sleep(300);
  }
  return out;
}

export const himalayas: Source = {
  name: "himalayas",
  fetch: () => fetchHimalayas(),
};
