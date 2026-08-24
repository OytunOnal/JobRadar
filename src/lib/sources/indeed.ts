import { profile } from "../user/profile";
import { apifyToken, runActor } from "./apify";
import { stripHtml, type RawJob, type Source } from "./types";

// Indeed jobs via the Apify actor kaix/indeed-scraper (pay-per-result from
// ~$0.04/1k, 54 country sites — the DACH gap closer). Runs only when
// APIFY_API_TOKEN is set. searchMode "detailed" fetches full descriptions;
// the shared runner logs each run's real cost.

const ACTOR = "kaix~indeed-scraper";

// Total jobs per ingest across all query×country combinations.
const MAX_ITEMS = Number(process.env.INDEED_MAX_ITEMS) || 60;

function queries(): string[] {
  const env = process.env.INDEED_QUERIES;
  if (env) return env.split(",").map((s) => s.trim()).filter(Boolean);
  return profile.tracks
    .filter((t) => !t.key.startsWith("general-"))
    .slice(0, 2)
    .map((t) => t.titleKeywords[0])
    .filter(Boolean);
}

function countries(): string[] {
  const env = process.env.INDEED_COUNTRIES;
  if (env) return env.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return ["de", "nl"];
}

interface KaixIndeedItem {
  id?: unknown;
  jobId?: unknown;
  jobKey?: unknown;
  title?: string;
  company?: string | { name?: string };
  companyName?: string;
  location?: string | { formattedAddressShort?: string; city?: string; countryCode?: string };
  url?: string;
  jobUrl?: string;
  link?: string;
  applyUrl?: string | null;
  originalApplyUrl?: string | null;
  externalApplyUrl?: string | null;
  thirdPartyApplyUrl?: string | null;
  isRemote?: boolean;
  remote?: boolean;
  description?: string;
  descriptionHtml?: string;
  jobDescription?: string;
  postedAt?: string | number;
  datePosted?: string | number;
  pubDate?: string | number;
  salary?: string | { text?: string; min?: number; max?: number };
}

function parseDate(raw: string | number | undefined): Date | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const d = new Date(typeof raw === "number" && raw < 1e12 ? raw * 1000 : raw);
  return isNaN(d.getTime()) ? undefined : d;
}

export function mapItem(item: KaixIndeedItem, country: string): RawJob | null {
  const jobId = String(item.id ?? item.jobId ?? item.jobKey ?? "");
  if (!jobId || !item.title) return null;

  const company =
    item.companyName ??
    (typeof item.company === "string" ? item.company : item.company?.name) ??
    "";
  const location =
    typeof item.location === "string"
      ? item.location
      : item.location?.formattedAddressShort ??
        [item.location?.city, item.location?.countryCode].filter(Boolean).join(", ");

  const indeedUrl = item.url ?? item.jobUrl ?? item.link ?? "";
  // The employer's own apply page beats the Indeed wall — and feeds harvest.
  const external = [item.originalApplyUrl, item.externalApplyUrl, item.thirdPartyApplyUrl, item.applyUrl]
    .find((u): u is string => !!u && /^https?:\/\//.test(u) && !/indeed\.com/i.test(u));
  const url = external ?? indeedUrl;
  if (!url) return null;

  const salaryText =
    typeof item.salary === "string" ? item.salary : item.salary?.text;

  return {
    source: "indeed",
    externalId: jobId,
    url,
    title: item.title,
    company,
    location: location || country.toUpperCase(),
    remote: Boolean(item.isRemote ?? item.remote) || /remote/i.test(location ?? ""),
    salaryText: salaryText?.slice(0, 100),
    description: stripHtml(item.descriptionHtml ?? item.description ?? item.jobDescription ?? ""),
    postedAt: parseDate(item.postedAt ?? item.datePosted ?? item.pubDate),
  };
}

export const indeed: Source = {
  name: "indeed",
  async fetch(): Promise<RawJob[]> {
    const token = apifyToken();
    if (!token) return [];

    const qs = queries();
    const cs = countries();
    const combos = qs.flatMap((q) => cs.map((c) => [q, c] as const));
    if (combos.length === 0) return [];
    const perCombo = Math.max(5, Math.floor(MAX_ITEMS / combos.length));

    const out: RawJob[] = [];
    const seen = new Set<string>();
    for (const [keyword, country] of combos) {
      const items = await runActor<KaixIndeedItem>(ACTOR, {
        keyword,
        country: country.toUpperCase(),
        maxItems: perCombo,
        sort: "date",
        fromDays: "7",
        searchMode: "detailed",
      }, token);
      for (const item of items) {
        const job = mapItem(item, country);
        if (job && !seen.has(job.externalId)) {
          seen.add(job.externalId);
          out.push(job);
        }
      }
    }
    return out;
  },
};
