import { getText, type RawJob, type Source } from "./types";

// Hunt UK Visa Sponsors — 70k+ UK jobs, every one cross-referenced against
// the gov.uk register of licensed sponsors and rated for sponsorship
// likelihood per occupation code. Found by the 2026-09 market scan
// (docs/ats-market-scan.md); the one board whose ENTIRE population sits on
// the axis this radar's user filters by.
//
// No JSON API (robots.txt disallows /api/ and is otherwise permissive), but
// the pages are server-rendered: the /jobs list is cursor-paginated cards,
// and each detail page carries a full schema.org JobPosting block — which
// means desc:fill's generic JSON-LD lane reads the body with zero bespoke
// parsing. This adapter only walks the newest N list pages.
//
// The card's sponsorship rating travels in the description text, NOT in the
// structured visa field. The rating is the site's inference from the
// register and occupation codes — company-level evidence, not the posting
// offering sponsorship — and writing visa="yes" from it would put sponsor✓
// ("the posting itself states it sponsors") on a posting that said no such
// thing. The card companies carry their legal register names, so our own GB
// register match (sponsorReg → sponsor?) does the structured half honestly.
//
// Config: HUNTUK_MAX_PAGES (default 5 ≈ 150 newest jobs per ingest).

const BASE = "https://huntukvisasponsors.com";
const MAX_PAGES = Number(process.env.HUNTUK_MAX_PAGES) || 5;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const RATING_LINE: Record<string, string> = {
  likely: "Sponsorship likely: this licensed sponsor issues visas for this occupation code.",
  possible: "Sponsorship possible: the company is a licensed sponsor, signal strength unclear.",
  unlikely: "Sponsorship unlikely: little sign this sponsor issues visas for this occupation code.",
};

export interface HuntUkCard {
  slug: string;
  title: string;
  company: string;
  rating: "likely" | "possible" | "unlikely" | null;
}

// The list page is one long server-rendered document; each card is an anchor
// to /job/{slug} wrapping the company logo (alt = legal register name), the
// title span, and a sponsorship tooltip. Split on the anchors and read each
// chunk — regexes stay per-field and shallow so a class-name change breaks
// one field visibly instead of everything quietly.
export function parseHuntUkList(html: string): { cards: HuntUkCard[]; nextUrl: string | null } {
  const cards: HuntUkCard[] = [];
  const seen = new Set<string>();
  const chunks = html.split(/href="\/job\//).slice(1);
  for (const chunk of chunks) {
    const slug = chunk.slice(0, chunk.indexOf('"'));
    if (!slug || seen.has(slug)) continue;
    const body = chunk.slice(0, 4000);
    const title = body.match(/font-medium">([^<]+)<\/span>/)?.[1]?.trim();
    const company = body.match(/<img alt="([^"]+)"/)?.[1]?.trim();
    if (!title || !company) continue;
    const ratingWord = body.match(/title="Sponsorship (likely|possible|unlikely)/)?.[1] as HuntUkCard["rating"];
    seen.add(slug);
    cards.push({ slug, title, company, rating: ratingWord ?? null });
  }
  const next = html.match(/rel="next" href="([^"]+)"/)?.[1] ?? null;
  return { cards, nextUrl: next };
}

export function mapHuntUkCard(c: HuntUkCard): RawJob {
  // Titles arrive as "Role | London, hybrid | up to £120k" — the segments
  // after the first pipe are the site's own metadata, not the employer's
  // title. Keep the role as the title; surface the rest in the description.
  const [role, ...meta] = c.title.split("|").map((s) => s.trim());
  const salaryish = meta.find((m) => /£|\bup to\b|per (year|annum|day|hour)/i.test(m));
  const locationish = meta.find((m) => m !== salaryish && m.length > 0);
  return {
    source: "huntukvisa",
    // The RSS-era rows (777 at the switchover) carry host/job/{slug} as their
    // identity; matching it makes every one a re-sighting instead of a
    // duplicate. The richer HTML walk replaced the feed, not the board.
    externalId: `huntukvisasponsors.com/job/${c.slug}`,
    url: `${BASE}/job/${c.slug}`,
    title: role || c.title,
    company: c.company,
    location: locationish ? `${locationish.replace(/,?\s*(hybrid|remote|on-?site)\s*$/i, "").trim() || "United Kingdom"}, United Kingdom` : "United Kingdom",
    remote: /\bremote\b/i.test(c.title),
    salaryText: salaryish,
    description: [
      `${role} at ${c.company}${locationish ? ` (${locationish}, UK)` : " (UK)"}.`,
      c.rating ? RATING_LINE[c.rating] : "",
    ].filter(Boolean).join(" "),
    // The card shows no date; the cursor walks newest-first and firstSeenAt
    // carries freshness, as with Breezy and Manatal.
  };
}

export const huntukvisasponsors: Source = {
  name: "huntukvisa",
  async fetch(): Promise<RawJob[]> {
    const out: RawJob[] = [];
    let url: string | null = `${BASE}/jobs`;
    for (let page = 0; page < MAX_PAGES && url; page++) {
      const html: string = await getText(url);
      const { cards, nextUrl } = parseHuntUkList(html);
      if (cards.length === 0) break;
      for (const c of cards) out.push(mapHuntUkCard(c));
      url = nextUrl;
      if (url) await sleep(1_500);
    }
    return out;
  },
};
