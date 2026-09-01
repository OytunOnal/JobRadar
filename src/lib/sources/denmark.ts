import { profileSearchGroups } from "../user/profile";
import { stripHtml, type RawJob, type Source } from "./types";

// Denmark — Jobnet (the national job board) via its web client's BFF API.
// Keyless; needs the "x-csrf: 1" header the web app sends. Search results
// carry the FULL description, so no detail calls. Newest-first ordering
// (orderType=PublicationDate) lets the window cutoff stop pagination early.
// Cloudflare may occasionally block automated requests — the source then
// degrades to a partial (or empty) result rather than failing the ingest.
//
// Config: DENMARK_WINDOW_DAYS (7)  DENMARK_MAX_PAGES (3, x50/page)

const SEARCH_URL = "https://jobnet.dk/bff/FindJob/Search";
const UA = "Mozilla/5.0 (compatible; JobRadar/0.1; personal job search)";
const WINDOW_DAYS = Number(process.env.DENMARK_WINDOW_DAYS) || 7;
const MAX_PAGES = Number(process.env.DENMARK_MAX_PAGES) || 3;
const LIMIT = 50;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function buildSearchUrl(query: string, page: number): string {
  const p = new URLSearchParams();
  p.set("searchString", query);
  p.set("resultsPerPage", String(LIMIT));
  p.set("pageNumber", String(page)); // 1-indexed
  p.set("orderType", "PublicationDate");
  return `${SEARCH_URL}?${p.toString()}`;
}

export function mapAd(ad: any): RawJob | null {
  if (!ad?.jobAdId || !ad?.title) return null;
  const city = ad.postalDistrictName || ad.municipality;
  return {
    source: "denmark-jobnet",
    externalId: String(ad.jobAdId),
    url: `https://jobnet.dk/find-job/${ad.jobAdId}`,
    title: String(ad.title),
    company: String(ad.hiringOrgName ?? ""),
    location: city ? `${city}, Denmark` : "Denmark",
    remote: false, // no flag; the work-mode detector reads the text
    description: stripHtml(ad.description ?? ""),
    postedAt: ad.publicationDate ? new Date(ad.publicationDate) : undefined,
  };
}

export async function fetchDenmark(fetchImpl: typeof fetch = fetch): Promise<RawJob[]> {
  const cutoff = Date.now() - WINDOW_DAYS * 86_400_000;
  const out: RawJob[] = [];
  const seen = new Set<string>();
  const titles = new Set<string>();
  for (const g of profileSearchGroups(4)) {
    titles.add(g.en[0]);
    if (g.da?.[0]) titles.add(g.da[0]);
  }

  for (const q of titles) {
    for (let page = 1; page <= MAX_PAGES; page++) {
      let data: any;
      try {
        const res = await fetchImpl(buildSearchUrl(q, page), {
          headers: { "User-Agent": UA, Accept: "application/json", "x-csrf": "1" },
          signal: AbortSignal.timeout(20_000),
        });
        if (!res.ok) break; // Cloudflare block or API change: degrade quietly
        data = await res.json();
      } catch {
        break;
      }
      const ads: any[] = data?.jobAds ?? [];
      let pageOldest = Infinity;
      for (const ad of ads) {
        const job = mapAd(ad);
        if (!job || seen.has(job.externalId)) continue;
        seen.add(job.externalId);
        const t = job.postedAt?.getTime();
        if (t !== undefined) pageOldest = Math.min(pageOldest, t);
        if (t !== undefined && t < cutoff) continue;
        out.push(job);
      }
      await sleep(400);
      // Newest-first: a page that ages past the window ends the walk.
      if (pageOldest < cutoff || ads.length < LIMIT) break;
    }
  }
  return out;
}

export const denmark: Source = {
  name: "denmark-jobnet",
  fetch: () => fetchDenmark(),
};
