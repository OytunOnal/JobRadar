import { getText, type RawJob, type Source } from "./types";

// Ergodotisi — Cyprus's dominant board (#42, from the #30 scan and re-verified
// in the main session). robots.txt is 190 bytes and permits crawling; the
// declared sitemap holds 5,166 job URLs, of which 2,573 are the en-CY host and
// the rest are their el-CY twins — same listing, two locales, so we keep one.
//
// No JSON-LD anywhere on the detail pages (checked: 81KB of HTML, no
// JobPosting block, no __NEXT_DATA__, no Nuxt payload). What there is instead
// is a strictly-shaped title — "Role at Company | Ergodotisi" — and a body in
// ordinary <p> tags. So this is a bespoke parse, the huntukvisa/visajobsie
// shape, and the fields come from the two places that are actually stable.
//
// WHY A GENERALIST BOARD IN A SMALL MARKET EARNS AN ADAPTER: Cyprus is an EU
// member whose working language is English, so its postings clear the language
// barrier that filters most of this pool — the same structural reason Ireland
// and Malta punch above their size here. Measured rather than assumed: in a
// 4-posting sample every body was predominantly Latin script (Latin characters
// outran Greek by 3x to 250x), so the English claim holds for the ads, not
// just for the site's chrome.
//
// Config: ERGODOTISI_MAX (default 30 detail fetches per ingest).

const SITEMAP = "https://ergodotisi.com/sitemap/jobs.xml";
const MAX = Number(process.env.ERGODOTISI_MAX) || 30;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** "Store Manager at The Biscuit Corner - MyCookieDough | Ergodotisi" →
 *  role + company. The board's suffix goes first, then the FIRST " at "
 *  splits: a role rarely contains " at ", a company name sometimes does. */
export function parseErgodotisiTitle(raw: string): { title: string; company: string } | null {
  const t = raw.replace(/\s*\|\s*Ergodotisi\s*$/i, "").trim();
  if (!t) return null;
  const i = t.indexOf(" at ");
  if (i <= 0) return { title: t, company: "" };
  return { title: t.slice(0, i).trim(), company: t.slice(i + 4).trim() };
}

/** The ad body lives in ordinary <p> tags; nav and chrome do not use long
 *  paragraphs, so "every <p> with more than 40 characters" separates them
 *  without pinning a class name a redesign would move. */
export function extractParagraphBody(html: string): string {
  return [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)]
    .map((m) => m[1]!.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim())
    .filter((t) => t.length > 40)
    .join("\n");
}

export function mapErgodotisiPage(url: string, html: string): RawJob | null {
  const parsed = parseErgodotisiTitle(html.match(/<title>([^<]*)<\/title>/)?.[1] ?? "");
  if (!parsed?.title) return null;
  const og = html.match(/property="og:description" content="([^"]*)"/)?.[1] ?? "";
  const body = extractParagraphBody(html) || og;
  const id = url.match(/-([a-f0-9]{8}-)?(\d{6,})$/)?.[2] ?? url;
  return {
    source: "ergodotisi",
    externalId: id,
    url,
    title: parsed.title,
    company: parsed.company || "?",
    location: "Cyprus",
    remote: /\bremote\b|work from home/i.test(`${parsed.title} ${body.slice(0, 400)}`),
    description: body || parsed.title,
    // The pages carry no posted date; firstSeenAt carries freshness, as with
    // Breezy, Manatal and huntukvisa.
  };
}

export const ergodotisi: Source = {
  name: "ergodotisi",
  async fetch(): Promise<RawJob[]> {
    const xml = await getText(SITEMAP);
    // en-CY only; the el-CY twin is the same listing in the other locale.
    const urls = [...xml.matchAll(/<loc>(https:\/\/ergodotisi\.com\/en-CY\/jobs\/[^<]+)<\/loc>/g)]
      .map((m) => m[1]!)
      .slice(0, MAX);
    const out: RawJob[] = [];
    for (const url of urls) {
      try {
        const job = mapErgodotisiPage(url, await getText(url));
        if (job) out.push(job);
      } catch { /* one dead posting is not a run failure */ }
      await sleep(700);
    }
    return out;
  },
};
