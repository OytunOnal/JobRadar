import { getText, type RawJob, type Source } from "./types";
import { extractJobPostingLd, parseJobSitemap } from "./jsonld";

// Cercolavoro — the reason Italy is not a closed market (#43, deep pass on
// #30, docs/scan-parts/italy.md). Verified in the main session: robots.txt is
// 1,210 bytes disallowing only /whoare/ with no AI-crawler ban, declares 12
// sitemaps, and the postings sitemap holds 988 entries refreshed hourly with
// full JobPosting JSON-LD on every detail page.
//
// THE DOMAIN IS THE LESSON. A screening sweep checked cercolavoro.IT, whose
// certificate is dead, and wrote the whole country off — "the largest
// unscanned EU tech market is closed". The live board is cercolavoro.COM. A
// negative about a market is only as good as the URL it was measured at.
//
// SIZED HONESTLY: this is a generalist board and its tech slice is small —
// 33 of 988 URLs carry tech words, and the first posting in the file is a
// dental assistant. Under the current tech-shaped profile most of it will
// score away, and that is fine: the door is one sitemap fetch, the bodies
// arrive complete, and the rows sit in the pool for the day the profile
// widens. Filtering belongs to the scorer, not to the ingest.
//
// Config: CERCOLAVORO_MAX (default 30 detail fetches per ingest, newest first).

const SITEMAP = "https://www.cercolavoro.com/sitemap/offerte_lavoro_elenco_proposte.xml";
const MAX = Number(process.env.CERCOLAVORO_MAX) || 30;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function mapCercolavoroLd(url: string, ld: any): RawJob | null {
  const title = String(ld?.title ?? "").trim();
  const company = String(ld?.hiringOrganization?.name ?? "").trim();
  if (!title || !company) return null;
  const site = Array.isArray(ld?.jobLocation) ? ld.jobLocation[0] : ld?.jobLocation;
  const city = String(site?.address?.addressLocality ?? "").trim();
  // Slugs end in the posting id: .../offerta-lavoro-<slug>-<city>-<id>
  const id = url.match(/-(\d{5,})\/?$/)?.[1] ?? url;
  return {
    source: "cercolavoro",
    externalId: id,
    url,
    title,
    company,
    location: [city, "Italy"].filter(Boolean).join(", "),
    remote: /\bremote\b|smart\s?working|telelavoro/i.test(`${title} ${city}`),
    description: String(ld?.description ?? "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/[ \t]+/g, " ")
      .trim() || `${title} at ${company}.`,
    postedAt: ld?.datePosted && !Number.isNaN(Date.parse(ld.datePosted)) ? new Date(ld.datePosted) : undefined,
  };
}

export const cercolavoro: Source = {
  name: "cercolavoro",
  async fetch(): Promise<RawJob[]> {
    const entries = parseJobSitemap(await getText(SITEMAP), /cercolavoro\.com\/offerta-lavoro-/).slice(0, MAX);
    const out: RawJob[] = [];
    for (const e of entries) {
      try {
        const ld = extractJobPostingLd(await getText(e.url));
        const job = ld && mapCercolavoroLd(e.url, ld);
        if (job) out.push(job);
      } catch { /* one dead posting is not a run failure */ }
      await sleep(700);
    }
    return out;
  },
};
