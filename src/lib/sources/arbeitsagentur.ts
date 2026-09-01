import { profileSearchGroups } from "../user/profile";
import { stripHtml, type RawJob, type Source } from "./types";

// Bundesagentur für Arbeit (the German federal employment agency) Jobsuche
// API — the national job board, keyless (the web client's static API key is
// public and documented by bund.dev's community). Germany's biggest single
// listing pool; local-language titles from searchVariants.de matter here,
// since the corpus is overwhelmingly German-titled.
//
// The v6 search returns cards (title, company, location, salary range — no
// description); the v4 jobdetails call carries the body and the employer's own
// URL. This connector returns every card it sees; desc:fill makes the detail
// call, ordered by the stored score.
//
// Config: BA_WINDOW_DAYS (7)  BA_SIZE (100/page)  BA_MAX_PAGES (4)

const SEARCH_URL = "https://rest.arbeitsagentur.de/jobboerse/jobsuche-service/pc/v6/jobs";
const DETAIL_URL = "https://rest.arbeitsagentur.de/jobboerse/jobsuche-service/pc/v4/jobdetails";
const API_KEY = "jobboerse-jobsuche"; // the public web client's static key
const UA = "JobRadar/0.1 (personal job search)";

const WINDOW_DAYS = Number(process.env.BA_WINDOW_DAYS) || 7;
const SIZE = Number(process.env.BA_SIZE) || 100;
const MAX_PAGES = Number(process.env.BA_MAX_PAGES) || 4;
// The store gate used to live here too, as a fourth copy of `20` — one per
// connector that fetched detail pages. It decided what the pool may contain,
// which is ingest's decision; the number now exists once, in derive.ts, and
// this connector no longer needs it.

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
    remote: false, // BA listings are location-bound; the work-mode detector reads the text
    salaryText: card.salaryText,
    // Converted HERE, in the pure mapper, rather than inside fetchDetail:
    // this function is exported and tested, and a mapper that trusts its
    // caller to have converted is a mapper that stores markup the day someone
    // calls it from anywhere else.
    description: stripHtml(detail?.description ?? ""),
    postedAt: card.postedAt,
  };
}

// Called by desc:fill, which owns detail fetching for every platform.
export async function fetchDetail(
  refnr: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ description?: string; externalUrl?: string }> {
  // The detail path takes the refnr base64-encoded (bund.dev-documented).
  const encoded = encodeURIComponent(Buffer.from(refnr).toString("base64"));
  const d = await baFetch(`${DETAIL_URL}/${encoded}`, fetchImpl);
  if (!d) return {};
  // Only externeUrl is a job link. allianzpartnerUrl is the partner site's
  // HOMEPAGE (live: "www.ihk.de") — as a job URL it would 404 the listing.
  const ext = d.externeUrl;
  return {
    // Raw on purpose — cardToRawJob converts. One conversion, in the pure
    // half, where a test can see it.
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

  // Every card this saw, not the best sixty of them.
  //
  // This used to score each card, drop everything under the gate, and fetch
  // detail pages for the survivors — so a connector was deciding what the pool
  // may contain, which is ingest's decision and the one thing store-all exists
  // to take away from it (ADR-1: the first store-all sweep recovered 341k
  // postings the old pipeline had been discarding in silence). A card dropped
  // here can never be re-scored when the scorer improves.
  //
  // The bodies arrive later: desc:fill owns detail fetching for every platform
  // that has a detail endpoint, ordered by the STORED score rather than a
  // guess made from a title.
  return [...cards.values()].map((card) => cardToRawJob(card));
}

export const arbeitsagentur: Source = {
  name: "arbeitsagentur",
  fetch: () => fetchArbeitsagentur(),
};
