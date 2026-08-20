import { profileSearchGroups } from "../profile";
import { scoreJob } from "../score";
import { stripHtml, type RawJob, type Source } from "./types";

// Switzerland — SECO's Job-Room (job-room.ch), the official national job
// platform. Keyless public JSON: POST search (title/company/preview per hit)
// + GET detail (full description). Search previews are ~200 chars, so this is
// two-stage like Arbeitsagentur: title score gates which ads get the detail
// call. German AND French variants both run — Switzerland posts in both.
// externalUrl on an ad is the employer/board posting; the Job-Room page
// otherwise.
//
// Config: CH_WINDOW_DAYS (7)  CH_MAX_PAGES (3, x50/page)  CH_DETAIL_MAX (40)

const SEARCH_URL = "https://www.job-room.ch/jobadservice/api/jobAdvertisements/_search";
const DETAIL_URL = "https://www.job-room.ch/jobadservice/api/jobAdvertisements";
const UA = "JobRadar/0.1 (personal job search)";
const WINDOW_DAYS = Number(process.env.CH_WINDOW_DAYS) || 7;
const MAX_PAGES = Number(process.env.CH_MAX_PAGES) || 3;
const DETAIL_MAX = Number(process.env.CH_DETAIL_MAX) || 40;
const LIMIT = 50;
// Mirrors ingest's STORE_THRESHOLD (importing it would be circular).
const SCORE_GATE = 20;

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
    description: description ?? card.preview,
    postedAt: card.postedAt,
  };
}

async function fetchDetail(id: string, fetchImpl: typeof fetch): Promise<string | undefined> {
  try {
    const res = await fetchImpl(`${DETAIL_URL}/${encodeURIComponent(id)}`, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return undefined;
    const d = await res.json();
    const jd = (d?.jobAdvertisement ?? d)?.jobContent?.jobDescriptions?.[0];
    return jd?.description ? stripHtml(String(jd.description)) : undefined;
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

  // Detail budget goes to the best title scores first (two-stage cost model).
  const scored = [...cards.values()]
    .map((card) => ({ card, score: scoreJob(cardToRawJob(card)) }))
    .filter(({ score }) => !score.disqualified && score.score >= SCORE_GATE)
    .sort((a, b) => b.score.score - a.score.score);

  const out: RawJob[] = [];
  for (const { card } of scored.slice(0, DETAIL_MAX)) {
    out.push(cardToRawJob(card, await fetchDetail(card.id, fetchImpl)));
    await sleep(300);
  }
  return out;
}

export const switzerland: Source = {
  name: "ch-jobroom",
  fetch: () => fetchSwitzerland(),
};
