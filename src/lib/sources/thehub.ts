import { type RawJob, type Source } from "./types";

// TheHub — the Nordic startup job board (thehub.io), keyless JSON. Two
// passes: EU-country postings and remote postings, deduped by id. The list
// payload has no body — title scoring classifies. (Contract learned from
// career-ops' thehub provider; response shape live-verified 2026-08:
// { jobs: { docs: [...], total, pages } }.)
//
// Config: THEHUB_MAX_PAGES (3, x15/page per pass)

const FEED = "https://thehub.io/api/v2/jobsandfeatured";
const UA = "JobRadar/0.1 (personal job search)";
const MAX_PAGES = Number(process.env.THEHUB_MAX_PAGES) || 3;
const PER_PAGE = 15;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function mapDoc(j: any): RawJob | null {
  const title = String(j?.title ?? "").trim();
  const id = String(j?.id ?? "").trim();
  if (!title || !id) return null;
  const loc = j.location ?? {};
  const address = String(loc.address ?? [loc.locality, loc.country].filter(Boolean).join(", "));
  return {
    source: "thehub",
    externalId: id,
    url: `https://thehub.io/jobs/${encodeURIComponent(id)}`,
    title,
    company: String(j.company?.name ?? "").trim(),
    location: address || undefined,
    remote: Boolean(j.isRemote),
    description: title, // list payload has no body — title scoring
    postedAt: undefined,
  };
}

export async function fetchTheHub(fetchImpl: typeof fetch = fetch): Promise<RawJob[]> {
  const out: RawJob[] = [];
  const seen = new Set<string>();
  for (const pass of ["countryCode=EU", "isRemote=true"]) {
    for (let page = 1; page <= MAX_PAGES; page++) {
      let data: any;
      try {
        const res = await fetchImpl(`${FEED}?page=${page}&perPage=${PER_PAGE}&${pass}`, {
          headers: { "User-Agent": UA, Accept: "application/json" },
          signal: AbortSignal.timeout(20_000),
        });
        if (!res.ok) break;
        data = await res.json();
      } catch {
        break;
      }
      const docs: any[] = data?.jobs?.docs ?? [];
      for (const d of docs) {
        const job = mapDoc(d);
        if (!job || seen.has(job.externalId)) continue;
        seen.add(job.externalId);
        out.push(job);
      }
      await sleep(300);
      if (docs.length < PER_PAGE) break;
    }
  }
  return out;
}

export const thehub: Source = {
  name: "thehub",
  fetch: () => fetchTheHub(),
};
