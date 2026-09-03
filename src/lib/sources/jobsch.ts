import { gunzipSync } from "node:zlib";
import { getText, type RawJob, type Source } from "./types";
import { extractJobPostingLd } from "./jsonld";

// jobs.ch — Switzerland's dominant board (#29, docs/scan-parts/switzerland.md).
// Verified in the main session: robots.txt names no AI crawler, declares three
// language sitemap trees, and — the part that decides the design — disallows
// `/api/`. So the board is telling us plainly which door to use, and we use
// that one: the declared sitemaps, never the JSON endpoints behind the SPA.
//
// The EN tree carries 42,695 individual `/en/vacancies/detail/{uuid}/` URLs
// across its gzipped children (counted, and the German tree carries the same
// postings in German). Detail pages carry complete schema.org JobPosting
// JSON-LD — live sample: "Civil Engineer" at Schnetzer Puskas Ingenieure AG,
// Zürich, 1,932-character body.
//
// ENGLISH TREE ON PURPOSE. Switzerland's postings exist in de/fr/en variants
// of the same vacancy; taking the EN tree gets the version this radar's user
// can read, and avoids ingesting the same job three times.
//
// WHAT WE DELIBERATELY DO NOT INGEST, recorded so nobody "fixes" it later:
// Job-Room (the federal service, arbeit.swiss) exposes an unauthenticated
// search API returning 74,094 live postings — technically the largest door in
// the country. Its robots.txt is 174 bytes and opens with the line
// "# Do not crawl Job Adverts", then disallows /job-search/. The API path is
// not literally listed, but pulling the advert corpus through the SPA's
// internal endpoint is exactly what that sentence forbids, reached by another
// door. We honour stated intent, not just the letter, so Job-Room is skipped.
//
// Config: JOBSCH_MAX (default 40 detail fetches per ingest).

const SITEMAP = "https://www.jobs.ch/sitemaps/jobs/en/sitemap.xml";
const MAX = Number(process.env.JOBSCH_MAX) || 40;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Sitemap children are gzipped; the index itself is plain. Entries come back
 * with their lastmod because ORDER MATTERS HERE: this tree is not
 * newest-first, and a naive head-of-file slice returned postings from May and
 * July 2025 on the first live run. Freshness has to be taken, not assumed. */
async function sitemapEntries(url: string): Promise<{ url: string; lastmod: string }[]> {
  const res = await fetch(url, {
    headers: { "User-Agent": "JobRadar/0.1 (personal job search)" },
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`jobs.ch ${url} -> HTTP ${res.status}`);
  const raw = Buffer.from(await res.arrayBuffer());
  const xml = url.endsWith(".gz") ? gunzipSync(raw).toString("utf8") : raw.toString("utf8");
  const out: { url: string; lastmod: string }[] = [];
  for (const m of xml.matchAll(/<(?:url|sitemap)>\s*<loc>([^<]+)<\/loc>(?:[\s\S]*?<lastmod>([^<]+)<\/lastmod>)?[\s\S]*?<\/(?:url|sitemap)>/g)) {
    out.push({ url: m[1]!, lastmod: m[2] ?? "" });
  }
  return out.sort((a, b) => b.lastmod.localeCompare(a.lastmod));
}

export function mapJobsChLd(url: string, ld: any): RawJob | null {
  const title = String(ld?.title ?? "").trim();
  const company = String(ld?.hiringOrganization?.name ?? "").trim();
  if (!title || !company) return null;
  // Not everything wearing JobPosting markup is a job: the first live run
  // pulled "Download Brochures and Price Lists | SIBIRGroup" off a marketing
  // page that had borrowed the schema. A title carrying a site-furniture
  // pipe segment, or a body too short to be an advert, is not a posting.
  if (/\|/.test(title) || String(ld?.description ?? "").length < 300) return null;
  const site = Array.isArray(ld?.jobLocation) ? ld.jobLocation[0] : ld?.jobLocation;
  const city = String(site?.address?.addressLocality ?? "").trim();
  return {
    source: "jobs-ch",
    // The UUID in the detail path is the posting's identity across languages.
    externalId: url.match(/detail\/([0-9a-f-]{36})/)?.[1] ?? url,
    url,
    title,
    company,
    location: [city, "Switzerland"].filter(Boolean).join(", "),
    remote: /\bremote\b|home\s?office|télétravail/i.test(`${title} ${city}`),
    description: String(ld?.description ?? "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/[ \t]+/g, " ")
      .trim() || `${title} at ${company}.`,
    postedAt: ld?.datePosted && !Number.isNaN(Date.parse(ld.datePosted)) ? new Date(ld.datePosted) : undefined,
  };
}

export const jobsch: Source = {
  name: "jobs-ch",
  async fetch(): Promise<RawJob[]> {
    const children = await sitemapEntries(SITEMAP);
    const urls: string[] = [];
    for (const child of children) {
      if (urls.length >= MAX) break;
      try {
        for (const e of await sitemapEntries(child.url)) {
          if (/\/vacancies\/detail\//.test(e.url)) urls.push(e.url);
          if (urls.length >= MAX) break;
        }
      } catch { /* one unreadable child is not a run failure */ }
    }

    const out: RawJob[] = [];
    for (const url of urls) {
      try {
        const ld = extractJobPostingLd(await getText(url));
        const job = ld && mapJobsChLd(url, ld);
        if (job) out.push(job);
      } catch { /* one dead posting is not a run failure */ }
      await sleep(700);
    }
    return out;
  },
};
