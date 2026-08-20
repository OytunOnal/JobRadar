import { profileSearchGroups } from "../profile";
import { scoreJob } from "../score";
import { type RawJob, type Source } from "./types";

// Bundesagentur für Arbeit (the German federal employment agency) Jobsuche
// API — the national job board, keyless (the web client's static API key is
// public and documented by bund.dev's community). Germany's biggest single
// listing pool; local-language titles from searchVariants.de matter here,
// since the corpus is overwhelmingly German-titled.
//
// Two-stage like LinkedIn: the v6 search returns cards (title, company,
// location, salary range — no description), the free title score gates which
// cards get a v4 jobdetails call (description + the employer's own URL when
// the posting has one).
//
// Config: BA_WINDOW_DAYS (7)  BA_SIZE (100/page)  BA_MAX_PAGES (4)
//         BA_DETAIL_MAX (60)

const SEARCH_URL = "https://rest.arbeitsagentur.de/jobboerse/jobsuche-service/pc/v6/jobs";
const DETAIL_URL = "https://rest.arbeitsagentur.de/jobboerse/jobsuche-service/pc/v4/jobdetails";
const API_KEY = "jobboerse-jobsuche"; // the public web client's static key
const UA = "JobRadar/0.1 (personal job search)";

const WINDOW_DAYS = Number(process.env.BA_WINDOW_DAYS) || 7;
const SIZE = Number(process.env.BA_SIZE) || 100;
const MAX_PAGES = Number(process.env.BA_MAX_PAGES) || 4;
const DETAIL_MAX = Number(process.env.BA_DETAIL_MAX) || 60;
// Mirrors ingest's STORE_THRESHOLD (importing it would be circular).
const SCORE_GATE = 20;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function buildSearchUrl(query: string, page = 1): string {
  const p = new URLSearchParams();
  p.set("was", query);
  p.set("angebotsart", "1"); // 1 = ARBEIT (jobs, not apprenticeships/trainings)
  p.set("veroeffentlichtseit", String(WINDOW_DAYS));
  p.set("size", String(SIZE));
  p.set("page", String(page));
  return `${SEARCH_URL}?${p.toString()}`;
}

async function baFetch(url: string, fetchImpl: typeof fetch): Promise<any | null> {
  try {
    const res = await fetchImpl(url, {
      headers: { "User-Agent": UA, "X-API-Key": API_KEY, Accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export interface BaCard {
  refnr: string;
  title: string;
  company: string;
  location: string;
  salaryText?: string;
  postedAt?: Date;
}

// v6 search result item → card. Fields verified live 2026-08.
export function parseCard(item: any): BaCard | null {
  const refnr = item?.referenznummer;
  const title = item?.stellenangebotsTitel;
  if (!refnr || !title) return null;
  const adresse = item.stellenlokationen?.[0]?.adresse;
  const ort = adresse?.ort ?? "";
  const land = adresse?.land === "DEUTSCHLAND" || !adresse?.land ? "Germany" : String(adresse.land);
  const salary =
    item.gehaltsspanneVon != null
      ? `${item.gehaltsspanneVon}–${item.gehaltsspanneBis ?? item.gehaltsspanneVon} EUR`
      : undefined;
  const posted = item.datumErsteVeroeffentlichung ?? item.aenderungsdatum;
  return {
    refnr: String(refnr),
    title: String(title),
    company: String(item.firma ?? ""),
    location: ort ? `${ort}, ${land}` : land,
    salaryText: salary,
    postedAt: posted ? new Date(posted) : undefined,
  };
}

export function cardToRawJob(card: BaCard, detail?: { description?: string; externalUrl?: string }): RawJob {
  return {
    source: "arbeitsagentur",
    externalId: card.refnr,
    // The employer's own posting URL when the listing carries one; otherwise
    // the public BA detail page.
    url: detail?.externalUrl || `https://www.arbeitsagentur.de/jobsuche/jobdetail/${encodeURIComponent(card.refnr)}`,
    title: card.title,
    company: card.company,
    location: card.location,
    remote: false, // BA listings are location-bound; deriveWorkMode reads the text
    salaryText: card.salaryText,
    description: detail?.description ?? "",
    postedAt: card.postedAt,
  };
}

export async function fetchDetail(
  refnr: string,
  fetchImpl: typeof fetch,
): Promise<{ description?: string; externalUrl?: string }> {
  // The detail path takes the refnr base64-encoded (bund.dev-documented).
  const encoded = encodeURIComponent(Buffer.from(refnr).toString("base64"));
  const d = await baFetch(`${DETAIL_URL}/${encoded}`, fetchImpl);
  if (!d) return {};
  // Only externeUrl is a job link. allianzpartnerUrl is the partner site's
  // HOMEPAGE (live: "www.ihk.de") — as a job URL it would 404 the listing.
  const ext = d.externeUrl;
  return {
    description: d.stellenangebotsBeschreibung ? String(d.stellenangebotsBeschreibung) : undefined,
    externalUrl: ext ? String(ext).replace(/^(?!https?:\/\/)/, "https://") : undefined,
  };
}

export async function fetchArbeitsagentur(fetchImpl: typeof fetch = fetch): Promise<RawJob[]> {
  // German titles lead here; the EN lead still runs (international companies
  // posting via BA title in English too).
  const queries = new Set<string>();
  for (const g of profileSearchGroups(4)) {
    if (g.de?.[0]) queries.add(g.de[0]);
    queries.add(g.en[0]);
  }

  // The window filter is server-side (veroeffentlichtseit), so paging just
  // walks the full weekly result: live, "softwareentwickler" alone is ~485
  // postings/week - a single 50-row page saw a tenth of it.
  const cards = new Map<string, BaCard>();
  for (const q of queries) {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const data = await baFetch(buildSearchUrl(q, page), fetchImpl);
      const items: any[] = data?.ergebnisliste ?? [];
      for (const item of items) {
        const card = parseCard(item);
        if (card && !cards.has(card.refnr)) cards.set(card.refnr, card);
      }
      await sleep(400);
      if (items.length < SIZE) break; // short page = done
    }
  }

  // Detail budget goes to the best title scores first (two-stage cost model).
  const scored = [...cards.values()]
    .map((card) => ({ card, score: scoreJob(cardToRawJob(card)) }))
    .filter(({ score }) => !score.disqualified && score.score >= SCORE_GATE)
    .sort((a, b) => b.score.score - a.score.score);

  const out: RawJob[] = [];
  for (const { card } of scored.slice(0, DETAIL_MAX)) {
    const detail = await fetchDetail(card.refnr, fetchImpl);
    out.push(cardToRawJob(card, detail));
    await sleep(300);
  }
  return out;
}

export const arbeitsagentur: Source = {
  name: "arbeitsagentur",
  fetch: () => fetchArbeitsagentur(),
};
