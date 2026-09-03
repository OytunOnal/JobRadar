import { getText, type RawJob, type Source } from "./types";
import { extractJobPostingLd, parseJobSitemap } from "./jsonld";

// karriere.at — Austria's dominant job board, and the cleanest door found in
// the DACH sweep (#29, docs/scan-parts/austria.md). Verified in the main
// session: robots.txt permits every generic crawler (only BLEXBot and
// AhrefsBot are named, and the wildcard group's Disallow is empty), the
// declared job sitemap holds 12,749 posting URLs, and every detail page
// carries complete schema.org JobPosting JSON-LD with a full body.
//
// THE PATH IS THE WHOLE LESSON. A screening pass reported this board on
// `karriere.at/sitemap-jobs-https.xml`, which answers 404 with a 70KB HTML
// error page. The working URL is the one robots.txt actually declares,
// under /static/sitemaps/. Same board, same day: shut at the guessed path,
// wide open at the declared one. Nothing here is guessed — every URL below
// came out of robots.txt.
//
// Austria is not in JUDGE_TARGETS today, so these postings enter the pool and
// wait for that decision rather than reaching the judge. They still earn
// their place: the board is the DACH region's largest, the bodies are
// complete at fetch time, and "at" is a one-word change when the user wants
// it.
//
// Config: KARRIEREAT_MAX (default 40 detail fetches per ingest, newest first).

const SITEMAP = "https://www.karriere.at/static/sitemaps/sitemap-jobs-https.xml";
const MAX = Number(process.env.KARRIEREAT_MAX) || 40;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function mapKarriereAtLd(url: string, ld: any): RawJob | null {
  const title = String(ld?.title ?? "").trim();
  const company = String(ld?.hiringOrganization?.name ?? "").trim();
  if (!title || !company) return null;
  // jobLocation is sometimes an array of sites; the first address is the one
  // the posting leads with.
  const site = Array.isArray(ld?.jobLocation) ? ld.jobLocation[0] : ld?.jobLocation;
  const city = String(site?.address?.addressLocality ?? "").trim();
  const id = url.match(/\/jobs\/(\d+)/)?.[1] ?? url;
  return {
    source: "karriereat",
    externalId: id,
    url,
    title,
    company,
    location: [city, "Austria"].filter(Boolean).join(", "),
    remote: /\bremote\b|home\s?office|telearbeit/i.test(`${title} ${city}`),
    description: String(ld?.description ?? "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/[ \t]+/g, " ")
      .trim() || `${title} at ${company}.`,
    postedAt: ld?.datePosted && !Number.isNaN(Date.parse(ld.datePosted)) ? new Date(ld.datePosted) : undefined,
  };
}

export const karriereat: Source = {
  name: "karriereat",
  async fetch(): Promise<RawJob[]> {
    const entries = parseJobSitemap(await getText(SITEMAP), /karriere\.at\/jobs\/\d+/).slice(0, MAX);
    const out: RawJob[] = [];
    for (const e of entries) {
      try {
        const ld = extractJobPostingLd(await getText(e.url));
        const job = ld && mapKarriereAtLd(e.url, ld);
        if (job) out.push(job);
      } catch { /* one dead posting is not a run failure */ }
      await sleep(700);
    }
    return out;
  },
};
