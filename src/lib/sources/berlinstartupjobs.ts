import { stripHtml, type RawJob, type Source } from "./types";

// Berlin Startup Jobs — the Berlin startup-scene board, via its WordPress RSS
// feed (~12 newest items per fetch; weekly cadence catches the flow). Titles
// look like "Job Title // Company". Cloudflare intermittently serves a
// challenge page instead of XML — detected and degraded to an empty result.

const FEED_URL = "https://berlinstartupjobs.com/feed/";
const UA = "Mozilla/5.0 (compatible; JobRadar/0.1; personal job search)";

function pick(block: string, tag: string): string {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  if (!m) return "";
  return m[1].replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "").trim();
}

export function parseFeed(xml: string): RawJob[] {
  const out: RawJob[] = [];
  for (const block of xml.split(/<item>/).slice(1)) {
    const body = block.split(/<\/item>/)[0];
    const link = pick(body, "link");
    const rawTitle = stripHtml(pick(body, "title"));
    if (!link || !rawTitle) continue;
    // "Job Title // Company" is the feed's convention. Numeric entities
    // (&#124; = "|") survive stripHtml; decode them before splitting.
    const decoded = rawTitle.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
    const [title, company] = decoded.split(/\s*\/\/\s*/);
    const pub = pick(body, "pubDate");
    out.push({
      source: "berlinstartupjobs",
      externalId: link.split("/").filter(Boolean).pop() ?? link,
      url: link,
      title: (title ?? decoded).trim(),
      company: (company ?? "").trim(),
      location: "Berlin, Germany",
      remote: false, // Berlin board; the work-mode detector reads the text
      description: stripHtml(pick(body, "content:encoded") || pick(body, "description")),
      postedAt: pub ? new Date(pub) : undefined,
    });
  }
  return out;
}

export const berlinstartupjobs: Source = {
  name: "berlinstartupjobs",
  async fetch(): Promise<RawJob[]> {
    try {
      const res = await fetch(FEED_URL, {
        headers: { "User-Agent": UA, Accept: "application/rss+xml, application/xml" },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) return [];
      const xml = await res.text();
      if (!xml.includes("<rss")) return []; // Cloudflare challenge page
      return parseFeed(xml);
    } catch {
      return [];
    }
  },
};
