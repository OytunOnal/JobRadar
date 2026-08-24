import { profileSearchGroups } from "../profile";
import { stripHtml, type RawJob, type Source } from "./types";

// Switzerland — SECO's Job-Room (job-room.ch), the official national job
// platform. Keyless public JSON: POST search (title/company/preview per hit)
// + GET detail (full description). Search previews are ~200 chars, so the
// preview is stored as a stand-in and desc:fill fetches the real body.
// German AND French variants both run — Switzerland posts in both.
// externalUrl on an ad is the employer/board posting; the Job-Room page
// otherwise.
//
// Config: CH_WINDOW_DAYS (7)  CH_MAX_PAGES (3, x50/page)

const SEARCH_URL = "https://www.job-room.ch/jobadservice/api/jobAdvertisements/_search";
const DETAIL_URL = "https://www.job-room.ch/jobadservice/api/jobAdvertisements";
const UA = "JobRadar/0.1 (personal job search)";
const WINDOW_DAYS = Number(process.env.CH_WINDOW_DAYS) || 7;
const MAX_PAGES = Number(process.env.CH_MAX_PAGES) || 3;
const LIMIT = 50;
// The store gate used to live here too, as a fourth copy of `20` — one per
// connector that fetched detail pages. It decided what the pool may contain,
// which is ingest's decision; the number now exists once, in derive.ts, and
// this connector no longer needs it.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function buildPayload(title: string): object {
  return {
    keywords: [title],
    workloadPercentageMin: 0,
    workloadPercentageMax: 100,
  };
}

export interface ChCard {
  id: string;
  title: string;
  company: string;
  location: string;
  externalUrl?: string;
  preview: string;
  postedAt?: Date;
}

export function parseAd(item: any): ChCard | null {
  const ad = item?.jobAdvertisement ?? item;
  const jc = ad?.jobContent;
  const jd = jc?.jobDescriptions?.[0];
  if (!ad?.id || !jd?.title) return null;
  const city = jc.location?.city;
  const pub = ad.publication?.startDate;
  return {
    id: String(ad.id),
    title: stripHtml(String(jd.title)), // search highlights titles with <em>
    company: String(jc.company?.name ?? ""),
    location: city ? `${city}, Switzerland` : "Switzerland",
    externalUrl: jc.externalUrl ? String(jc.externalUrl) : undefined,
    preview: stripHtml(String(jd.description ?? "")),
    postedAt: pub ? new Date(pub) : undefined,
  };
}

export function cardToRawJob(card: ChCard, description?: string): RawJob {
  return {
    source: "ch-jobroom",
    externalId: card.id,
    url: card.externalUrl || `https://www.job-room.ch/job-search/${card.id}`,
    title: card.title,
    company: card.company,
    location: card.location,
    remote: false, // deriveWorkMode reads the text
    // Converted here rather than trusting the caller. `preview` arrives
    // already converted from parseAd, and htmlToText on clean text is a no-op;
    // a detail body handed in raw is not, and this mapper is exported.
    description: stripHtml(description ?? card.preview),
    postedAt: card.postedAt,
  };
}

// Exported for desc:fill, which owns detail fetching for every platform.
export async function fetchDetail(id: string, fetchImpl: typeof fetch = fetch): Promise<string | undefined> {
  try {
    const res = await fetchImpl(`${DETAIL_URL}/${encodeURIComponent(id)}`, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return undefined;
    const d = await res.json();
    const jd = (d?.jobAdvertisement ?? d)?.jobContent?.jobDescriptions?.[0];
    // Raw on purpose — cardToRawJob converts, so there is exactly one place.
    return jd?.description ? String(jd.description) : undefined;
  } catch {
    return undefined;
  }
}

export async function fetchSwitzerland(fetchImpl: typeof fetch = fetch): Promise<RawJob[]> {
  const cutoff = Date.now() - WINDOW_DAYS * 86_400_000;
  const cards = new Map<string, ChCard>();
  const titles = new Set<string>();
  for (const g of profileSearchGroups(4)) {
    titles.add(g.en[0]);
    if (g.de?.[0]) titles.add(g.de[0]);
    if (g.fr?.[0]) titles.add(g.fr[0]);
  }

  for (const q of titles) {
    for (let page = 0; page < MAX_PAGES; page++) {
      let data: any;
      try {
        const res = await fetchImpl(`${SEARCH_URL}?page=${page}&size=${LIMIT}`, {
          method: "POST",
          headers: { "User-Agent": UA, "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(buildPayload(q)),
          signal: AbortSignal.timeout(20_000),
        });
        if (!res.ok) break;
        data = await res.json();
      } catch {
        break;
      }
      const items: any[] = Array.isArray(data) ? data : [];
      for (const item of items) {
        const card = parseAd(item);
        if (!card || cards.has(card.id)) continue;
        // No date ordering guarantee from the API — filter, don't early-stop.
        if (card.postedAt && card.postedAt.getTime() < cutoff) continue;
        cards.set(card.id, card);
      }
      await sleep(400);
      if (items.length < LIMIT) break;
    }
  }

  // Every card, with its ~200-character preview as the body for now. The full
  // description is a detail call, and detail calls belong to desc:fill — which
  // orders them by the stored score rather than by a guess from a title, and
  // has a budget and a circuit breaker this loop never had.
  return [...cards.values()].map((card) => cardToRawJob(card));
}

export const switzerland: Source = {
  name: "ch-jobroom",
  fetch: () => fetchSwitzerland(),
};
