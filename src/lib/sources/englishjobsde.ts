import { getText, type RawJob, type Source } from "./types";

// EnglishJobs.de — English-language German postings with a first-class
// visa-sponsorship facet, found by the 2026-09 country scan
// (docs/scan-parts/germany.md). We walk ONLY the /jobs/visa_sponsorship
// facet: the general feed is aggregator content we largely see elsewhere,
// and the facet is the board's whole value for this radar.
//
// Its robots disallows /clickout/* and every job link IS a clickout — so
// this adapter reads everything off the listing HTML and stores the
// clickout URL as the apply link WITHOUT ever fetching it. That also means
// no detail fetch and no desc:fill lane: the teaser (which carries the
// sponsorship sentence and often the salary) is the whole body, and the
// keyword scorer works on titles anyway (the SmartRecruiters trade, minus
// the later repair).
//
// Config: ENGLISHJOBS_MAX_PAGES (default 3 ≈ 60 postings; the facet held
// ~209 total at scan time, so three pages cover the fresh head).

const BASE = "https://englishjobs.de";
const MAX_PAGES = Number(process.env.ENGLISHJOBS_MAX_PAGES) || 3;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const MONTHS: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};

// "August 11" — no year. The board lists live postings, so the date is the
// most recent occurrence of that day: this year, unless that lands in the
// future, then last year.
export function parseListedDate(text: string, now: Date = new Date()): Date | undefined {
  const m = text.match(/([A-Z][a-z]+)\s+(\d{1,2})/);
  if (!m) return undefined;
  const month = MONTHS[m[1]!.toLowerCase()];
  if (month === undefined) return undefined;
  // UTC, like every other source's postedAt — the local-time constructor
  // shipped first and shifted the day backwards for any reader east of
  // Greenwich, which the test caught as August 11 rendering as the 10th.
  const d = new Date(Date.UTC(now.getUTCFullYear(), month, Number(m[2])));
  if (d.getTime() > now.getTime()) d.setUTCFullYear(d.getUTCFullYear() - 1);
  return d;
}

export interface EnglishJobsCard {
  id: string;
  clickout: string;
  title: string;
  company: string;
  location: string;
  dateText: string;
  teaser: string;
}

// Result blocks are delimited by <!-- result --> comments; inside each, the
// title is microdata (itemprop="title"), the company and location are the
// first two <li> rows, and the teaser is the gray summary div. Per-field
// shallow regexes as ever.
export function parseEnglishJobsList(html: string): EnglishJobsCard[] {
  const out: EnglishJobsCard[] = [];
  for (const block of html.split("<!-- result -->").slice(1)) {
    const id = block.match(/id="([a-f0-9]{12,})"/)?.[1];
    const clickout = block.match(/href="(\/clickout\/[^"]+)"/)?.[1]?.replace(/&amp;/g, "&");
    const title = block.match(/itemprop="title">([^<]+)</)?.[1]?.trim();
    if (!id || !clickout || !title) continue;
    const lis = [...block.matchAll(/<li class="flex text-sm[^"]*">[\s\S]*?<\/svg>\s*([^<]+)</g)].map((m) => m[1]!.trim());
    const teaser = block.match(/text-gray-400[^>]*>(?:<img[^>]*>)?([\s\S]*?)<\/div>/)?.[1]
      ?.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() ?? "";
    out.push({
      id,
      clickout,
      title,
      company: lis[0] ?? "",
      location: lis[1] ?? "",
      dateText: lis[2] ?? "",
      teaser,
    });
  }
  return out;
}

export function mapEnglishJobsCard(c: EnglishJobsCard, now: Date = new Date()): RawJob | null {
  if (!c.company) return null;
  return {
    source: "englishjobsde",
    externalId: c.id,
    url: `${BASE}${c.clickout}`,
    title: c.title,
    company: c.company,
    location: c.location ? `${c.location}, Germany` : "Germany",
    remote: /\bremote\b/i.test(`${c.title} ${c.location}`),
    description: [
      `${c.title} at ${c.company} (${c.location || "Germany"}). Listed under visa sponsorship on EnglishJobs.de.`,
      c.teaser,
    ].filter(Boolean).join(" "),
    postedAt: parseListedDate(c.dateText, now),
  };
}

export const englishjobsde: Source = {
  name: "englishjobsde",
  async fetch(): Promise<RawJob[]> {
    const out: RawJob[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const html = await getText(`${BASE}/jobs/visa_sponsorship${page > 1 ? `?page=${page}` : ""}`);
      const cards = parseEnglishJobsList(html);
      if (cards.length === 0) break;
      for (const c of cards) {
        const job = mapEnglishJobsCard(c);
        if (job) out.push(job);
      }
      if (page < MAX_PAGES) await sleep(1_500);
    }
    return out;
  },
};
