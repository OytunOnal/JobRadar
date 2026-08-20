import { profileSearchGroups } from "../profile";
import { stripHtml, type RawJob, type Source } from "./types";

// Sweden — Arbetsförmedlingen's JobTech "JobSearch" API (jobsearch.api.
// jobtechdev.se): the national job board, keyless, clean JSON, server-side
// date filter (published-after) and offset pagination. Swedish tech postings
// are largely English-titled, so the EN leads carry most of the load; sv
// variants join when the profile has them.
//
// Config: SWEDEN_WINDOW_DAYS (7)  SWEDEN_MAX_PAGES (3, x100/page)

const SEARCH_URL = "https://jobsearch.api.jobtechdev.se/search";
const UA = "JobRadar/0.1 (personal job search)";
const WINDOW_DAYS = Number(process.env.SWEDEN_WINDOW_DAYS) || 7;
const MAX_PAGES = Number(process.env.SWEDEN_MAX_PAGES) || 3;
const LIMIT = 100;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function buildSearchUrl(query: string, page: number, cutoffIso: string): string {
  const p = new URLSearchParams();
  p.set("q", query);
  p.set("limit", String(LIMIT));
  p.set("offset", String(page * LIMIT));
  p.set("published-after", cutoffIso);
  return `${SEARCH_URL}?${p.toString()}`;
}

export function mapHit(h: any): RawJob | null {
  if (!h?.id || !h?.headline) return null;
  const city = h.workplace_address?.municipality;
  return {
    source: "sweden-jobtech",
    externalId: String(h.id),
    // application_details.url is the employer's own channel when present;
    // webpage_url is the Platsbanken detail page.
    url: String(h.application_details?.url || h.webpage_url || ""),
    title: String(h.headline),
    company: String(h.employer?.name ?? ""),
    location: city ? `${city}, Sweden` : "Sweden",
    remote: false, // no reliable flag; deriveWorkMode reads the text
    description: stripHtml(h.description?.text ?? ""),
    postedAt: h.publication_date ? new Date(h.publication_date) : undefined,
  };
}

export async function fetchSweden(fetchImpl: typeof fetch = fetch): Promise<RawJob[]> {
  const cutoffIso = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString().slice(0, 19);
  const out: RawJob[] = [];
  const seen = new Set<string>();
  const titles = new Set<string>();
  for (const g of profileSearchGroups(4)) {
    titles.add(g.en[0]);
    if (g.sv?.[0]) titles.add(g.sv[0]);
  }

  for (const q of titles) {
    for (let page = 0; page < MAX_PAGES; page++) {
      let data: any;
      try {
        const res = await fetchImpl(buildSearchUrl(q, page, cutoffIso), {
          headers: { "User-Agent": UA, Accept: "application/json" },
          signal: AbortSignal.timeout(20_000),
        });
        if (!res.ok) break;
        data = await res.json();
      } catch {
        break; // partial result beats none
      }
      const hits: any[] = data?.hits ?? [];
      for (const h of hits) {
        const job = mapHit(h);
        if (!job || !job.url || seen.has(job.externalId)) continue;
        seen.add(job.externalId);
        out.push(job);
      }
      await sleep(300);
      if (hits.length < LIMIT) break; // short page = window exhausted
    }
  }
  return out;
}

export const sweden: Source = {
  name: "sweden-jobtech",
  fetch: () => fetchSweden(),
};
