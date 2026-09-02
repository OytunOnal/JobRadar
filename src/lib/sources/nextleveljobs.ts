import { getText, type RawJob, type Source } from "./types";

// Next Level Jobs EU — sponsor-curated European tech board, verified across
// three country scans (docs/country-board-scan.md): open robots, a job
// sitemap with same-day lastmod, server-rendered pages whose JSON-LD
// JobPosting is complete (title, org, datePosted, location with country,
// full description). The scan's caveat stands and shapes the budget: its
// inventory is big-name sponsors largely reachable through our ATS
// discovery already, so this adapter is a small, bounded lane whose main
// yields are (a) the sponsorship-curation signal on postings we might hold
// from elsewhere — dedupe upgrades trust — and (b) the company slugs in its
// sitemap, which seed-curated.ts harvests for the probe.
//
// The sitemap is the list (URL + lastmod, no titles), so each posting costs
// one detail fetch. NEXTLEVEL_MAX (default 30) caps that spend per ingest,
// newest lastmod first; re-sightings of known rows are cheap because the
// fetch happens before identity is known only for genuinely new URLs — the
// cap keeps even the worst case (all 30 new) at 30 polite requests.

const BASE = "https://nextleveljobs.eu";
const MAX = Number(process.env.NEXTLEVEL_MAX) || 30;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface SitemapEntry {
  url: string;
  lastmod: string;
}

export function parseJobSitemap(xml: string): SitemapEntry[] {
  const out: SitemapEntry[] = [];
  for (const m of xml.matchAll(/<url>\s*<loc>([^<]+)<\/loc>(?:[\s\S]*?<lastmod>([^<]+)<\/lastmod>)?[\s\S]*?<\/url>/g)) {
    if (m[1]!.includes("/jobs/")) out.push({ url: m[1]!, lastmod: m[2] ?? "" });
  }
  return out.sort((a, b) => b.lastmod.localeCompare(a.lastmod));
}

/** Distinct company slugs across the whole sitemap — the harvest half. */
export function companiesFromSitemap(xml: string): string[] {
  const slugs = new Set<string>();
  for (const m of xml.matchAll(/\/companies\/([a-z0-9-]+)\/jobs\//g)) slugs.add(m[1]!);
  return [...slugs];
}

export function mapJobPostingLd(url: string, ld: any): RawJob | null {
  const title = String(ld?.title ?? "").trim();
  const company = String(ld?.hiringOrganization?.name ?? "").trim();
  if (!title || !company) return null;
  const addr = ld?.jobLocation?.address;
  const location = [addr?.addressLocality, addr?.addressCountry].filter(Boolean).join(", ");
  const slug = url.split("/companies/")[1] ?? url;
  return {
    source: "nextleveljobs",
    externalId: slug,
    url,
    title,
    company,
    location,
    remote: /\bremote\b/i.test(`${title} ${location}`),
    description: String(ld?.description ?? "").replace(/<[^>]+>/g, " ").replace(/[ \t]+/g, " ").trim()
      || `${title} at ${company}. Listed on Next Level Jobs EU (sponsor-curated).`,
    postedAt: ld?.datePosted && !Number.isNaN(Date.parse(ld.datePosted)) ? new Date(ld.datePosted) : undefined,
  };
}

export function extractJobPostingLd(html: string): any | null {
  for (const m of html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    try {
      const data = JSON.parse(m[1]!);
      for (const node of Array.isArray(data) ? data : [data]) {
        if (node?.["@type"] === "JobPosting") return node;
      }
    } catch { /* next block */ }
  }
  return null;
}

export const nextleveljobs: Source = {
  name: "nextleveljobs",
  async fetch(): Promise<RawJob[]> {
    const xml = await getText(`${BASE}/jobs/sitemap.xml`);
    const entries = parseJobSitemap(xml).slice(0, MAX);
    const out: RawJob[] = [];
    for (const e of entries) {
      try {
        const ld = extractJobPostingLd(await getText(e.url));
        const job = ld && mapJobPostingLd(e.url, ld);
        if (job) out.push(job);
      } catch { /* one dead page is not a run failure */ }
      await sleep(800);
    }
    return out;
  },
};
