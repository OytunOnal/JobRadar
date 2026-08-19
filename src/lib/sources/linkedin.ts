import { profile } from "../profile";
import { apifyToken, runActor } from "./apify";
import { stripHtml, type RawJob, type Source, type WorkMode } from "./types";

// LinkedIn jobs via the Apify actor kaix/linkedin-jobs-scraper (guest API,
// pay-per-result from ~$0.09/1k — the actual cost per run is logged by the
// shared runner). Runs only when APIFY_API_TOKEN is set; the free Apify plan
// ships ~$5/month of credit and the budget below stays far inside it.
//
// When a posting carries the company's own apply URL we prefer it over the
// LinkedIn login wall — better for the user, and the harvest layer mines it
// for ATS board discovery.

const ACTOR = "kaix~linkedin-jobs-scraper";

// Total jobs per ingest across all title×location combinations.
const MAX_ITEMS = Number(process.env.LINKEDIN_MAX_ITEMS) || 150;

function searchTitles(): string[] {
  const env = process.env.LINKEDIN_TITLES;
  if (env) return env.split(",").map((s) => s.trim()).filter(Boolean);
  // Specific (non-safety-net) tracks' lead title keywords describe the user.
  return profile.tracks
    .filter((t) => !t.key.startsWith("general-"))
    .slice(0, 4)
    .map((t) => t.titleKeywords[0])
    .filter(Boolean);
}

function searchLocations(): string[] {
  const env = process.env.LINKEDIN_LOCATIONS;
  if (env) return env.split(",").map((s) => s.trim()).filter(Boolean);
  return ["European Union", "Turkey"];
}

interface KaixLinkedInItem {
  id?: unknown;
  jobId?: unknown;
  title?: string;
  jobTitle?: string;
  company?: string | { name?: string };
  companyName?: string;
  location?: string | { linkedinText?: string; parsed?: { city?: string } };
  workType?: string;
  workplaceType?: string;
  url?: string;
  jobUrl?: string;
  link?: string;
  linkedinUrl?: string;
  applyUrl?: string | null;
  externalApplyUrl?: string | null;
  applicationUrl?: string | null;
  applyMethod?: { companyApplyUrl?: string | null };
  applicationMethod?: string;
  postedDate?: string | number;
  postedAt?: string | number;
  listedAt?: string | number;
  publishedAt?: string | number;
  descriptionHtml?: string;
  descriptionText?: string;
  description?: string;
  jobDescription?: string;
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
    (typeof item.company === "string" ? item.company : item.company?.name) ??
    "";
  const location =
    typeof item.location === "string"
      ? item.location
      : item.location?.linkedinText ?? item.location?.parsed?.city ?? "";

  const linkedinUrl =
    item.linkedinUrl ?? item.jobUrl ?? item.url ?? item.link ??
    `https://www.linkedin.com/jobs/view/${jobId}/`;
  // First external (non-LinkedIn) application URL wins — harvest food.
  const applyCandidates = [
    item.externalApplyUrl,
    item.applyMethod?.companyApplyUrl,
    item.applicationUrl,
    item.applyUrl,
  ];
  const external = applyCandidates.find(
    (u): u is string => !!u && /^https?:\/\//.test(u) && !/linkedin\.com/i.test(u),
  );
  const url = external ?? linkedinUrl;

  const wp = (item.workType ?? item.workplaceType ?? "").toLowerCase();
  const workMode: WorkMode | undefined = wp.includes("remote")
    ? "remote"
    : wp.includes("hybrid")
      ? "hybrid"
      : wp.includes("on") ? "onsite" : undefined;

  const salaryText =
    typeof item.salary === "string" ? item.salary : item.salary?.text;

  return {
    source: "linkedin",
    externalId: jobId,
    url,
    title,
    company,
    location,
    remote: workMode === "remote" || /remote/i.test(location),
    workMode,
    salaryText: salaryText?.slice(0, 100),
    description: stripHtml(
      item.descriptionHtml ?? item.descriptionText ?? item.jobDescription ?? item.description ?? "",
    ),
    postedAt: parseDate(item.postedDate ?? item.postedAt ?? item.listedAt ?? item.publishedAt),
  };
}

export const linkedin: Source = {
  name: "linkedin",
  async fetch(): Promise<RawJob[]> {
    const token = apifyToken();
    if (!token) return [];

    const titles = searchTitles();
    const locations = searchLocations();
    const combos = titles.flatMap((t) => locations.map((l) => [t, l] as const));
    if (combos.length === 0) return [];
    const perCombo = Math.max(5, Math.floor(MAX_ITEMS / combos.length));

    const out: RawJob[] = [];
    const seen = new Set<string>();
    for (const [keywords, location] of combos) {
      const items = await runActor<KaixLinkedInItem>(ACTOR, {
        keywords,
        location,
        maxJobs: perCombo,
        fetchDetails: true,
        sortBy: "recent",
        datePosted: "past_week",
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
  },
};
