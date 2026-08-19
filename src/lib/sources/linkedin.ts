import { profile } from "../profile";
import { stripHtml, type RawJob, type Source, type WorkMode } from "./types";

// LinkedIn jobs via the Apify actor harvestapi/linkedin-job-search.
// Runs only when APIFY_API_TOKEN is set (free Apify plan ships ~$5 of monthly
// credit; at roughly $1 per 1k results the default budget below stays free).
// Two-for-one: when a posting carries the company's own apply URL we prefer it
// over the LinkedIn page — better for the user (no login wall), and the
// harvest layer mines it for ATS board discovery.

const ACTOR = "harvestapi~linkedin-job-search";
const BASE = "https://api.apify.com/v2";

// ~150/run × daily-ish runs ≈ 4-5k jobs/month — inside the free credit.
const MAX_ITEMS = Number(process.env.LINKEDIN_MAX_ITEMS) || 150;
const POLL_MS = 5_000;
const RUN_TIMEOUT_MS = 8 * 60_000;

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface HarvestItem {
  id?: unknown;
  jobId?: unknown;
  title?: string;
  company?: string | { name?: string };
  location?: string | { linkedinText?: string; parsed?: { city?: string } };
  workplaceType?: string;
  linkedinUrl?: string;
  url?: string;
  applyMethod?: { companyApplyUrl?: string | null };
  applyUrl?: string | null;
  postedDate?: string | number;
  listedAt?: string | number;
  descriptionHtml?: string;
  descriptionText?: string;
  description?: string;
  salary?: { text?: string; payPeriod?: string };
}

export function mapItem(item: HarvestItem): RawJob | null {
  const jobId = String(item.id ?? item.jobId ?? "");
  if (!jobId || !item.title) return null;

  const company =
    typeof item.company === "string" ? item.company : item.company?.name ?? "";
  const location =
    typeof item.location === "string"
      ? item.location
      : item.location?.linkedinText ?? item.location?.parsed?.city ?? "";

  const linkedinUrl =
    item.linkedinUrl ?? item.url ?? `https://www.linkedin.com/jobs/view/${jobId}/`;
  // The company's own apply page beats the LinkedIn login wall — and feeds
  // the harvest layer's ATS discovery.
  const companyApply = item.applyMethod?.companyApplyUrl ?? item.applyUrl ?? null;
  const url = companyApply && companyApply !== linkedinUrl ? companyApply : linkedinUrl;

  const wp = (item.workplaceType ?? "").toLowerCase();
  const workMode: WorkMode | undefined = wp.includes("remote")
    ? "remote"
    : wp.includes("hybrid")
      ? "hybrid"
      : wp.includes("on")
        ? "onsite"
        : undefined;

  const rawDate = item.postedDate ?? item.listedAt;
  const postedAt = rawDate ? new Date(typeof rawDate === "number" && rawDate < 1e12 ? rawDate * 1000 : rawDate) : undefined;

  return {
    source: "linkedin",
    externalId: jobId,
    url,
    title: item.title,
    company,
    location,
    remote: workMode === "remote" || /remote/i.test(location),
    workMode,
    salaryText: item.salary?.text?.slice(0, 100),
    description: stripHtml(item.descriptionHtml ?? item.descriptionText ?? item.description ?? ""),
    postedAt: postedAt && !isNaN(postedAt.getTime()) ? postedAt : undefined,
  };
}

export const linkedin: Source = {
  name: "linkedin",
  async fetch(): Promise<RawJob[]> {
    const token = process.env.APIFY_API_TOKEN;
    if (!token) return [];

    const input = {
      jobTitles: searchTitles(),
      locations: searchLocations(),
      postedLimit: "week",
      sortBy: "date",
      maxItems: MAX_ITEMS,
    };
    const started = await fetch(`${BASE}/acts/${ACTOR}/runs?token=${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!started.ok) throw new Error(`apify run start: HTTP ${started.status}`);
    const run = (await started.json()).data;

    const deadline = Date.now() + RUN_TIMEOUT_MS;
    let status = run.status as string;
    while (["READY", "RUNNING"].includes(status)) {
      if (Date.now() > deadline) throw new Error("apify run timed out");
      await sleep(POLL_MS);
      const res = await fetch(`${BASE}/actor-runs/${run.id}?token=${token}`);
      if (!res.ok) throw new Error(`apify run poll: HTTP ${res.status}`);
      status = (await res.json()).data.status;
    }
    if (status !== "SUCCEEDED") throw new Error(`apify run ended: ${status}`);

    const items = await fetch(
      `${BASE}/datasets/${run.defaultDatasetId}/items?token=${token}&format=json&clean=true`,
    );
    if (!items.ok) throw new Error(`apify dataset: HTTP ${items.status}`);
    const data = (await items.json()) as HarvestItem[];
    return data.map(mapItem).filter((j): j is RawJob => j !== null);
  },
};
