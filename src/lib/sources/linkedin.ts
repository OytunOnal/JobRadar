import { profile } from "../profile";
import { scoreJob } from "../score";
import { apifyToken, runActor } from "./apify";
import { stripHtml, type RawJob, type Source, type WorkMode } from "./types";

// LinkedIn jobs via the public jobs-guest endpoints — free, no auth, no keys.
// (Validated live; the same endpoints the paid Apify actors wrap. LinkedIn's
// ToS disallows automated access, so this stays personal-use: low volume,
// weekly cadence, polite backoff.)
//
// Search design (the tiered matrix from the search-strategy discussion):
//   CITY searches      × onsite+hybrid  — depth in hub cities (country queries
//                                         cap out and miss the tail)
//   COUNTRY searches   × remote         — country-bound remote roles
//   "European Union"   × remote         — cross-border EU-remote roles
// Tiers are nearly disjoint by construction; ingest dedupe absorbs overlap.
//
// Cost model is two-stage: search cards carry title/company/location/date —
// enough for the free title-first keyword score. Full descriptions are fetched
// only for cards that pass, within a per-run budget.
//
// Config (interim until the planned `searches` config block):
//   LINKEDIN_TITLES     comma-sep;  default: specific tracks' lead keywords
//   LINKEDIN_CITIES     ";"-sep     default: Berlin/Munich/Amsterdam/Istanbul
//   LINKEDIN_COUNTRIES  ";"-sep     default: Germany;Netherlands;Turkey
//   LINKEDIN_WINDOW_DAYS (7)  LINKEDIN_PAGES (2/search)  LINKEDIN_DETAIL_MAX (120)
//   LINKEDIN_VIA_APIFY=1 switches to the kaix Apify actor (paid fallback).

const SEARCH_URL = "https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search";
const DETAIL_URL = "https://www.linkedin.com/jobs-guest/jobs/api/jobPosting";
const UA = "Mozilla/5.0 (compatible; JobRadar/0.1; personal job search)";

const WINDOW_DAYS = Number(process.env.LINKEDIN_WINDOW_DAYS) || 7;
const PAGES_PER_SEARCH = Number(process.env.LINKEDIN_PAGES) || 2;
const DETAIL_MAX = Number(process.env.LINKEDIN_DETAIL_MAX) || 120;
// Mirrors ingest's STORE_THRESHOLD (importing it would be circular).
const SCORE_GATE = 20;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Config → search plan ─────────────────────────────────────────────────────

function titles(): string[] {
  const env = process.env.LINKEDIN_TITLES;
  if (env) return env.split(",").map((s) => s.trim()).filter(Boolean);
  return profile.tracks
    .filter((t) => !t.key.startsWith("general-"))
    .slice(0, 4)
    .map((t) => t.titleKeywords[0])
    .filter(Boolean);
}

// ";"-separated because LinkedIn place strings contain commas.
function splitEnv(name: string, fallback: string[]): string[] {
  const env = process.env[name];
  if (env) return env.split(";").map((s) => s.trim()).filter(Boolean);
  return fallback;
}

export interface PlannedSearch {
  keywords: string;
  location: string;
  workTypes: string[]; // LinkedIn f_WT codes: 1=onsite, 2=remote, 3=hybrid
  tier: "city" | "country" | "region";
}

export function searchPlan(
  titleList: string[],
  cities: string[],
  countries: string[],
): PlannedSearch[] {
  const plan: PlannedSearch[] = [];
  for (const keywords of titleList) {
    for (const location of cities) {
      plan.push({ keywords, location, workTypes: ["1", "3"], tier: "city" });
    }
    for (const location of countries) {
      plan.push({ keywords, location, workTypes: ["2"], tier: "country" });
    }
    plan.push({ keywords, location: "European Union", workTypes: ["2"], tier: "region" });
  }
  return plan;
}

export function buildSearchUrl(s: PlannedSearch, page: number, windowDays = WINDOW_DAYS): string {
  const p = new URLSearchParams();
  p.set("keywords", s.keywords);
  p.set("location", s.location);
  p.set("f_TPR", `r${windowDays * 86_400}`);
  if (s.workTypes.length) p.set("f_WT", s.workTypes.join(","));
  p.set("start", String(page * 10));
  return `${SEARCH_URL}?${p.toString()}`;
}

// ── Polite fetch ─────────────────────────────────────────────────────────────

async function guestFetch(url: string): Promise<string> {
  let delay = 800;
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
        "X-Requested-With": "XMLHttpRequest",
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 429 || res.status >= 500) {
      await sleep(delay + Math.random() * 400);
      delay = Math.min(delay * 2, 8_000);
      continue;
    }
    if (res.status === 404) return "";
    if (!res.ok) throw new Error(`linkedin guest: HTTP ${res.status}`);
    return res.text();
  }
  throw new Error("linkedin guest: still throttled after retries");
}

// ── Parsers (validated against live captures) ────────────────────────────────

export interface GuestCard {
  id: string;
  title: string;
  company: string;
  location: string;
  url: string;
  postedAt?: Date;
}

export function parseJobCards(html: string): GuestCard[] {
  const cards: GuestCard[] = [];
  // Each result card carries data-entity-urn="urn:li:jobPosting:<id>".
  const chunks = html.split(/data-entity-urn="urn:li:jobPosting:/).slice(1);
  for (const chunk of chunks) {
    const id = chunk.match(/^(\d+)/)?.[1];
    if (!id) continue;
    const title = chunk.match(/base-search-card__title[^>]*>\s*([\s\S]*?)\s*<\//)?.[1];
    const company =
      chunk.match(/hidden-nested-link[^>]*>\s*([\s\S]*?)\s*<\//)?.[1] ??
      chunk.match(/base-search-card__subtitle[^>]*>[\s\S]*?>\s*([\s\S]*?)\s*<\//)?.[1] ?? "";
    const location = chunk.match(/job-search-card__location[^>]*>\s*([\s\S]*?)\s*<\//)?.[1] ?? "";
    const datetime = chunk.match(/datetime="([^"]+)"/)?.[1];
    const href = chunk.match(/base-card__full-link[^>]*href="([^"]+)"/)?.[1];
    if (!title) continue;
    const postedAt = datetime ? new Date(datetime) : undefined;
    cards.push({
      id,
      title: stripHtml(title),
      company: stripHtml(company),
      location: stripHtml(location),
      url: href ? href.replace(/&amp;/g, "&").split("?")[0] : `https://www.linkedin.com/jobs/view/${id}`,
      postedAt: postedAt && !isNaN(postedAt.getTime()) ? postedAt : undefined,
    });
  }
  return cards;
}

// Depth-tracked <div> extraction: the description markup contains nested divs,
// so a lazy regex would cut it short.
export function extractDivContent(html: string, className: string): string | null {
  const open = new RegExp(`<div[^>]*class="[^"]*${className}[^"]*"[^>]*>`, "i").exec(html);
  if (!open) return null;
  let i = open.index + open[0].length;
  let depth = 1;
  while (depth > 0 && i < html.length) {
    const nextOpen = html.indexOf("<div", i);
    const nextClose = html.indexOf("</div>", i);
    if (nextClose === -1) return null;
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++;
      i = nextOpen + 4;
    } else {
      depth--;
      i = nextClose + 6;
    }
  }
  return html.slice(open.index + open[0].length, i - 6);
}

export function parseJobDetail(html: string): string {
  const markup = extractDivContent(html, "show-more-less-html__markup");
  return markup ? stripHtml(markup) : "";
}

// ── Guest-API fetch (primary) ────────────────────────────────────────────────

async function fetchViaGuestApi(): Promise<RawJob[]> {
  const plan = searchPlan(
    titles(),
    splitEnv("LINKEDIN_CITIES", ["Berlin, Germany", "Munich, Germany", "Amsterdam, Netherlands", "Istanbul, Turkey"]),
    splitEnv("LINKEDIN_COUNTRIES", ["Germany", "Netherlands", "Turkey"]),
  );

  const seen = new Set<string>();
  const candidates: Array<{ card: GuestCard; remoteTier: boolean }> = [];
  for (const search of plan) {
    for (let page = 0; page < PAGES_PER_SEARCH; page++) {
      const html = await guestFetch(buildSearchUrl(search, page));
      const cards = parseJobCards(html);
      for (const card of cards) {
        if (seen.has(card.id)) continue;
        seen.add(card.id);
        candidates.push({ card, remoteTier: search.tier !== "city" });
      }
      await sleep(900 + Math.random() * 600); // personal-use pacing
      if (cards.length < 10) break; // last page of this search
    }
  }

  // Stage 2: full descriptions only for cards the free title score approves.
  const out: RawJob[] = [];
  let detailBudget = DETAIL_MAX;
  for (const { card, remoteTier } of candidates) {
    const base: RawJob = {
      source: "linkedin",
      externalId: card.id,
      url: card.url,
      title: card.title,
      company: card.company,
      location: card.location,
      remote: remoteTier || /remote/i.test(card.location),
      workMode: remoteTier ? ("remote" as WorkMode) : undefined,
      description: "",
      postedAt: card.postedAt,
    };
    const s = scoreJob(base);
    if (s.disqualified || s.score < SCORE_GATE) continue;
    if (detailBudget > 0) {
      try {
        const detailHtml = await guestFetch(`${DETAIL_URL}/${card.id}`);
        base.description = parseJobDetail(detailHtml);
        detailBudget--;
        await sleep(700 + Math.random() * 500);
      } catch {
        /* card data alone is still a valid listing */
      }
    }
    if (!base.description) base.description = base.title;
    out.push(base);
  }
  return out;
}

// ── Apify fallback (kaix actor, paid) — kept behind LINKEDIN_VIA_APIFY ───────

interface KaixLinkedInItem {
  id?: unknown; jobId?: unknown;
  title?: string; jobTitle?: string;
  company?: string | { name?: string }; companyName?: string;
  location?: string | { linkedinText?: string; parsed?: { city?: string } };
  workType?: string; workplaceType?: string;
  url?: string; jobUrl?: string; link?: string; linkedinUrl?: string;
  applyUrl?: string | null; externalApplyUrl?: string | null; applicationUrl?: string | null;
  applyMethod?: { companyApplyUrl?: string | null };
  postedDate?: string | number; postedAt?: string | number;
  listedAt?: string | number; publishedAt?: string | number;
  descriptionHtml?: string; descriptionText?: string; description?: string; jobDescription?: string;
  salary?: string | { text?: string };
}

function parseDate(raw: string | number | undefined): Date | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const d = new Date(typeof raw === "number" && raw < 1e12 ? raw * 1000 : raw);
  return isNaN(d.getTime()) ? undefined : d;
}

export function mapItem(item: KaixLinkedInItem): RawJob | null {
  const jobId = String(item.id ?? item.jobId ?? "");
  const title = item.title ?? item.jobTitle;
  if (!jobId || !title) return null;
  const company =
    item.companyName ??
    (typeof item.company === "string" ? item.company : item.company?.name) ?? "";
  const location =
    typeof item.location === "string"
      ? item.location
      : item.location?.linkedinText ?? item.location?.parsed?.city ?? "";
  const linkedinUrl =
    item.linkedinUrl ?? item.jobUrl ?? item.url ?? item.link ??
    `https://www.linkedin.com/jobs/view/${jobId}/`;
  const external = [item.externalApplyUrl, item.applyMethod?.companyApplyUrl, item.applicationUrl, item.applyUrl]
    .find((u): u is string => !!u && /^https?:\/\//.test(u) && !/linkedin\.com/i.test(u));
  const wp = (item.workType ?? item.workplaceType ?? "").toLowerCase();
  const workMode: WorkMode | undefined = wp.includes("remote")
    ? "remote" : wp.includes("hybrid") ? "hybrid" : wp.includes("on") ? "onsite" : undefined;
  const salaryText = typeof item.salary === "string" ? item.salary : item.salary?.text;
  return {
    source: "linkedin",
    externalId: jobId,
    url: external ?? linkedinUrl,
    title,
    company,
    location,
    remote: workMode === "remote" || /remote/i.test(location),
    workMode,
    salaryText: salaryText?.slice(0, 100),
    description: stripHtml(item.descriptionHtml ?? item.descriptionText ?? item.jobDescription ?? item.description ?? ""),
    postedAt: parseDate(item.postedDate ?? item.postedAt ?? item.listedAt ?? item.publishedAt),
  };
}

async function fetchViaApify(token: string): Promise<RawJob[]> {
  const titleList = titles();
  const locations = splitEnv("LINKEDIN_COUNTRIES", ["Germany", "Netherlands", "Turkey"]);
  const combos = titleList.flatMap((t) => locations.map((l) => [t, l] as const));
  if (combos.length === 0) return [];
  const maxItems = Number(process.env.LINKEDIN_MAX_ITEMS) || 150;
  const perCombo = Math.max(5, Math.floor(maxItems / combos.length));
  const out: RawJob[] = [];
  const seen = new Set<string>();
  for (const [keywords, location] of combos) {
    const items = await runActor<KaixLinkedInItem>("kaix~linkedin-jobs-scraper", {
      keywords, location, maxJobs: perCombo, fetchDetails: true, sortBy: "recent", datePosted: "past_week",
    }, token);
    for (const item of items) {
      const job = mapItem(item);
      if (job && !seen.has(job.externalId)) {
        seen.add(job.externalId);
        out.push(job);
      }
    }
  }
  return out;
}

export const linkedin: Source = {
  name: "linkedin",
  async fetch(): Promise<RawJob[]> {
    if (process.env.LINKEDIN_VIA_APIFY === "1") {
      const token = apifyToken();
      return token ? fetchViaApify(token) : [];
    }
    return fetchViaGuestApi();
  },
};
