import { stripHtml, type RawJob, type Source } from "./types";

// Net-Empregos — Portugal's biggest general job board, via its open RSS
// (1000 newest postings; the flow is high-volume and all-sector, so a
// category filter keeps only the IT slice before scoring). The feed is
// iso-8859-1 encoded — decoded explicitly, or Portuguese text mojibakes.
// Item descriptions carry "Empresa: X / Categoria: Y / Zona: Z" only; the
// title is the signal (PT tech titles embed English terms: developer,
// frontend, devops…).

const FEED_URL = "https://www.net-empregos.com/rss.asp";
const UA = "Mozilla/5.0 (compatible; JobRadar/0.1; personal job search)";
// The board's IT-ish category names (accent-insensitive match).
const IT_CATEGORY_RE = /inform.tica|programa..o|tecnolog|telecomunica|internet|multim.dia|engenharia/i;

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
    const title = stripHtml(pick(body, "title"));
    if (!link || !title) continue;
    // description is double-escaped HTML: "Empresa: X<br>Categoria: Y<br>Zona: Z"
    const desc = stripHtml(stripHtml(pick(body, "description")));
    if (!IT_CATEGORY_RE.test(desc)) continue; // all-sector feed → IT slice only
    const company = /Empresa:\s*([^]*?)(?:Categoria:|Zona:|Data:|$)/.exec(desc)?.[1]?.trim() ?? "";
    const zona = /Zona:\s*([^]*?)(?:Empresa:|Categoria:|Data:|$)/.exec(desc)?.[1]?.trim() ?? "";
    const pub = pick(body, "pubDate");
    out.push({
      source: "netempregos",
      externalId: /\/(\d+)\//.exec(link)?.[1] ?? link,
      url: link,
      title,
      company,
      location: zona ? `${zona}, Portugal` : "Portugal",
      remote: /teletrabalho|remoto|remote/i.test(`${title} ${desc}`),
      description: desc,
      postedAt: pub ? new Date(pub) : undefined,
    });
  }
  return out;
}

export const netempregos: Source = {
  name: "netempregos",
  async fetch(): Promise<RawJob[]> {
    try {
      const res = await fetch(FEED_URL, {
        headers: { "User-Agent": UA, Accept: "application/rss+xml, application/xml" },
        signal: AbortSignal.timeout(25_000),
      });
      if (!res.ok) return [];
      // iso-8859-1 — res.text() would decode as UTF-8 and mangle Portuguese.
      const xml = new TextDecoder("latin1").decode(await res.arrayBuffer());
      if (!xml.includes("<rss")) return [];
      return parseFeed(xml);
    } catch {
      return [];
    }
  },
};
