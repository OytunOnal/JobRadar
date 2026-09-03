import { getText, type RawJob, type Source } from "./types";
import { extractJobPostingLd, parseJobSitemap } from "./jsonld";

// Demando — Swedish tech-only board, found by the Nordics scan (#28,
// docs/scan-parts/sweden.md): permissive robots, a positions sitemap
// (~1,500 URLs, both demando.io and demando.se hosts), and complete
// JobPosting JSON-LD per detail page. The sitemap-fed shape shared with
// nextleveljobs and freework — list from the sitemap, one detail fetch per
// new URL, full data at fetch time, no desc:fill debt.
//
// The sitemap lists each position under both hosts; we keep the .io host and
// dedupe by the company/position slug so the pair collapses to one row.
//
// Config: DEMANDO_MAX (default 25 detail fetches per ingest, newest first).

const SITEMAP = "https://demando.io/sitemap/positions-sitemap.xml";
const MAX = Number(process.env.DEMANDO_MAX) || 25;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function mapDemandoLd(url: string, ld: any): RawJob | null {
  const title = String(ld?.title ?? "").trim();
  const company = String(ld?.hiringOrganization?.name ?? "").trim();
  if (!title || !company) return null;
  // The sitemap's newest-first head carries the board's own demo tenant; a
  // "(Copy)" title and a "Demo" company are its fingerprints.
  if (/Demo/.test(company) || /\(Copy\)/i.test(title)) return null;
  const loc = ld?.jobLocation?.address?.addressLocality;
  const slug = url.split("/company/")[1] ?? url;
  return {
    source: "demando",
    externalId: slug,
    url,
    title,
    company,
    location: [loc, "Sweden"].filter(Boolean).join(", "),
    remote: /\bremote\b|\bdistans\b/i.test(`${title} ${loc ?? ""}`),
    description: String(ld?.description ?? "").replace(/<[^>]+>/g, " ").replace(/[ \t]+/g, " ").trim()
      || `${title} at ${company}.`,
    postedAt: ld?.datePosted && !Number.isNaN(Date.parse(ld.datePosted)) ? new Date(ld.datePosted) : undefined,
  };
}

export const demando: Source = {
  name: "demando",
  async fetch(): Promise<RawJob[]> {
    const xml = await getText(SITEMAP);
    // Keep the .io host only; the .se twin carries the same slug.
    const entries = parseJobSitemap(xml, /demando\.io\/company\/.+\/jobs\//).slice(0, MAX);
    const out: RawJob[] = [];
    for (const e of entries) {
      try {
        const ld = extractJobPostingLd(await getText(e.url));
        const job = ld && mapDemandoLd(e.url, ld);
        if (job) out.push(job);
      } catch { /* one dead page is not a run failure */ }
      await sleep(700);
    }
    return out;
  },
};
