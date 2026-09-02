import { getText, type RawJob, type Source } from "./types";
import { extractJobPostingLd, parseJobSitemap } from "./jsonld";

// Free-Work — the strongest pure-French find of the 2026-09 country scan
// (docs/country-board-scan.md): IT-only, permanent and freelance, daily
// regenerated sitemaps split by language. We walk the EN-GB TECH sitemap
// only (738 real postings at probe time): the English slice is the one this
// radar's user can act on, and the French slice would arrive wearing
// requires-fr flags anyway.
//
// The scan said the pages carry no JSON-LD; probing for the adapter showed
// they DO (full JobPosting on the live sample) — so the shape is the
// nextleveljobs one: sitemap for the list, one detail fetch per new
// posting, complete data at fetch time, no desc:fill debt.
//
// Config: FREEWORK_MAX (default 25 detail fetches per ingest, newest first).

const SITEMAP = "https://statics.free-work.com/sitemap-job-postings-en-gb--tech.xml";
const MAX = Number(process.env.FREEWORK_MAX) || 25;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function mapFreeWorkLd(url: string, ld: any): RawJob | null {
  const title = String(ld?.title ?? "").trim();
  const company = String(ld?.hiringOrganization?.name ?? "").trim();
  if (!title || !company) return null;
  const addr = ld?.jobLocation?.address ?? (Array.isArray(ld?.jobLocation) ? ld.jobLocation[0]?.address : undefined);
  const location = [addr?.addressLocality, addr?.addressCountry].filter(Boolean).join(", ");
  const slug = url.split("/job-mission/")[1] ?? url;
  return {
    source: "freework",
    externalId: slug,
    url,
    title,
    company,
    location,
    remote: /\bremote\b|\bfull remote\b/i.test(`${title} ${JSON.stringify(ld?.jobLocationType ?? "")}`),
    description: String(ld?.description ?? "").replace(/<[^>]+>/g, " ").replace(/[ \t]+/g, " ").trim()
      || `${title} at ${company}.`,
    postedAt: ld?.datePosted && !Number.isNaN(Date.parse(ld.datePosted)) ? new Date(ld.datePosted) : undefined,
  };
}

export const freework: Source = {
  name: "freework",
  async fetch(): Promise<RawJob[]> {
    const xml = await getText(SITEMAP);
    const entries = parseJobSitemap(xml, /\/job-mission\//).slice(0, MAX);
    const out: RawJob[] = [];
    for (const e of entries) {
      try {
        const ld = extractJobPostingLd(await getText(e.url));
        const job = ld && mapFreeWorkLd(e.url, ld);
        if (job) out.push(job);
      } catch { /* one dead page is not a run failure */ }
      await sleep(800);
    }
    return out;
  },
};
