import { getText, type RawJob, type Source } from "./types";

// Posao.hr — Croatia's board (#44). Its detail pages carry no JSON-LD, but
// its category RSS feeds do something better for our purposes: they LABEL the
// employer. Each item's description opens "Poslodavac: <company>", then the
// place of work and the application deadline, which is exactly the trio a
// card needs — and it is why this board shipped while two larger, cleaner
// sources (Actiris, Silicon Luxembourg) were parked this week for omitting
// the employer entirely.
//
// Category feeds rather than the whole board: the IT/telecoms feed is the
// slice this radar wants, and taking it at the source is cheaper than
// filtering 3,955 sitemap URLs afterwards. A caveat the sample made plain —
// the IT feed still carries non-IT and non-Croatian rows (an electrician in
// Germany led it), so the keyword scorer does its usual work.
//
// Config: POSAOHR_FEEDS (comma-separated category slugs), POSAOHR_MAX.

const BASE = "https://www.posao.hr/rss";
const FEEDS = (process.env.POSAOHR_FEEDS || "it-telekomunikacije").split(",").map((s) => s.trim()).filter(Boolean);
const MAX = Number(process.env.POSAOHR_MAX) || 60;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function decode(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
}

export function parsePosaoFeed(xml: string): RawJob[] {
  const out: RawJob[] = [];
  for (const block of xml.split(/<item>/).slice(1)) {
    const body = block.split(/<\/item>/)[0]!;
    const pick = (tag: string) =>
      decode(body.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "i"))?.[1] ?? "").trim();
    const link = pick("link");
    const title = pick("title");
    if (!link || !title) continue;
    const desc = decode(pick("description"));
    // "Poslodavac: Silverhand Croatia<div>Mjesto rada: Babenhausen, Njemačka</div>"
    const company = desc.match(/Poslodavac:\s*([^<]{2,80})/i)?.[1]?.trim() ?? "";
    // Without an employer this is not a row we can dedupe, match against a
    // register, or render — the Actiris rule, applied per item.
    if (!company) continue;
    const place = desc.match(/Mjesto rada:\s*([^<]{2,80})/i)?.[1]?.trim() ?? "";
    const pub = pick("pubDate");
    out.push({
      source: "posao-hr",
      externalId: /\/oglasi\/[^/]+\/(\d+)/.exec(link)?.[1] ?? link,
      url: link,
      title,
      company,
      location: place || "Croatia",
      remote: /\brad na daljinu\b|\bremote\b/i.test(`${title} ${desc}`),
      description: desc.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || title,
      postedAt: pub && !Number.isNaN(Date.parse(pub)) ? new Date(pub) : undefined,
    });
  }
  return out;
}

export const posaohr: Source = {
  name: "posao-hr",
  async fetch(): Promise<RawJob[]> {
    const out: RawJob[] = [];
    const seen = new Set<string>();
    for (const feed of FEEDS) {
      if (out.length >= MAX) break;
      try {
        for (const job of parsePosaoFeed(await getText(`${BASE}/${feed}/`))) {
          if (seen.has(job.externalId) || out.length >= MAX) continue;
          seen.add(job.externalId);
          out.push(job);
        }
      } catch { /* one dead feed is not a run failure */ }
      await sleep(600);
    }
    return out;
  },
};
