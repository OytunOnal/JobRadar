import { profileSearchGroups } from "../profile";
import { stripHtml, type RawJob, type Source } from "./types";

// Jobindex — Denmark's biggest PRIVATE job board (complements the public
// Jobnet source). The search page serves clean RSS via ?format=rss&q=…,
// 20 items per feed, entity-escaped HTML in the description. Titles look
// like "Role, Company" or "Role til Company"; the item's category carries
// the board's own job family.
//
// Config: JOBINDEX_WINDOW_DAYS (7)

const BASE = "https://www.jobindex.dk/jobsoegning";
const UA = "Mozilla/5.0 (compatible; JobRadar/0.1; personal job search)";
const WINDOW_DAYS = Number(process.env.JOBINDEX_WINDOW_DAYS) || 7;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
}

function pick(block: string, tag: string): string {
  const m = block.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  if (!m) return "";
  return m[1].replace(/^\s*<!\[CDATA\[/, "").replace(/\]\]>\s*$/, "").trim();
}

export function parseFeed(xml: string): RawJob[] {
  const out: RawJob[] = [];
  for (const block of xml.split(/<item>/).slice(1)) {
    const body = block.split(/<\/item>/)[0];
    const link = pick(body, "link");
    const rawTitle = stripHtml(decodeEntities(pick(body, "title")));
    if (!link || !rawTitle) continue;
    // "Role til Company, City" / "Role, Company" — keep the whole string as
    // title (keyword scoring matches substrings) and guess company from the
    // last comma segment when there are several.
    const segments = rawTitle.split(",").map((s) => s.trim());
    const company = segments.length > 1 ? segments[segments.length - 1] : "";
    const pub = pick(body, "pubDate");
    out.push({
      source: "jobindexdk",
      externalId: /\/vis-job\/([a-z0-9]+)/i.exec(link)?.[1] ?? link,
      url: link,
      title: rawTitle,
      company,
      location: "Denmark",
      remote: false, // deriveWorkMode reads the text
      description: stripHtml(decodeEntities(decodeEntities(pick(body, "description")))),
      postedAt: pub ? new Date(pub) : undefined,
    });
  }
  return out;
}

export async function fetchJobindex(fetchImpl: typeof fetch = fetch): Promise<RawJob[]> {
  const cutoff = Date.now() - WINDOW_DAYS * 86_400_000;
  const out: RawJob[] = [];
  const seen = new Set<string>();
  const titles = new Set<string>();
  for (const g of profileSearchGroups(4)) {
    titles.add(g.en[0]);
    if (g.da?.[0]) titles.add(g.da[0]);
  }
  for (const q of titles) {
    let xml = "";
    try {
      const res = await fetchImpl(`${BASE}?format=rss&q=${encodeURIComponent(q)}`, {
        headers: { "User-Agent": UA, Accept: "application/rss+xml, application/xml" },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) continue;
      xml = await res.text();
    } catch {
      continue;
    }
    if (!xml.includes("<rss")) continue;
    for (const job of parseFeed(xml)) {
      if (seen.has(job.externalId)) continue;
      seen.add(job.externalId);
      const t = job.postedAt?.getTime();
      if (t !== undefined && t < cutoff) continue;
      out.push(job);
    }
    await sleep(400);
  }
  return out;
}

export const jobindexdk: Source = {
  name: "jobindexdk",
  fetch: () => fetchJobindex(),
};
