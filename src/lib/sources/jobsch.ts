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

// Two brands, one platform. jobup.ch is the same operator's Romandie site:
// identical sitemap layout and JSON-LD, differing only in the host, the
// sitemap prefix and one path segment (vacancies/ vs jobs/). Same shared
// mapper, one fetch contract each — the itjobbank/jobindexdk pattern, not a
// copied file. Counted 2026-09-04: jobs.ch 42,695 EN detail URLs, jobup.ch
// 35,647. They share an operator, so some postings appear on both; the
// cross-source dedupe collapses those on title+company as it already does
// for EURES and the national boards.
interface ChSite {
  name: string;
  sitemap: string;
  detailPath: RegExp;
  country: string;
}

const SITES: Record<string, ChSite> = {
  "jobs-ch": {
    name: "jobs-ch",
    sitemap: "https://www.jobs.ch/sitemaps/jobs/en/sitemap.xml",
    detailPath: /\/vacancies\/detail\//,
    country: "Switzerland",
  },
  "jobup-ch": {
    name: "jobup-ch",
    sitemap: "https://www.jobup.ch/sitemaps/jobup/en/sitemap.xml",
    detailPath: /\/jobs\/detail\//,
    country: "Switzerland",
  },
};

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

export function mapJobsChLd(url: string, ld: any, source = "jobs-ch"): RawJob | null {
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
    source,
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

async function fetchSite(site: ChSite): Promise<RawJob[]> {
  const children = await sitemapEntries(site.sitemap);
  const urls: string[] = [];
  for (const child of children) {
    if (urls.length >= MAX) break;
    try {
      for (const e of await sitemapEntries(child.url)) {
        if (site.detailPath.test(e.url)) urls.push(e.url);
        if (urls.length >= MAX) break;
      }
    } catch { /* one unreadable child is not a run failure */ }
  }

  const out: RawJob[] = [];
  for (const url of urls) {
    try {
      const ld = extractJobPostingLd(await getText(url));
      const job = ld && mapJobsChLd(url, ld, site.name);
      if (job) out.push(job);
    } catch { /* one dead posting is not a run failure */ }
    await sleep(700);
  }
  return out;
}

export const jobsch: Source = {
  name: "jobs-ch",
  fetch: () => fetchSite(SITES["jobs-ch"]!),
};

export const jobupch: Source = {
  name: "jobup-ch",
  fetch: () => fetchSite(SITES["jobup-ch"]!),
};
