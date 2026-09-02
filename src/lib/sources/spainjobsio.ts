import { getText, type RawJob, type Source } from "./types";

// SpainJobs.io — the cleanest door the 2026-09 country scan found in Spain:
// robots.txt is Allow:/ with an explicit `Content-Signal: ai-input=yes`, the
// one board scanned that positively invites this kind of reader.
//
// Deliberately scoped to its CURATED VISA SURFACE, not the 40k-URL job
// sitemap: the sitemap's bulk is hospitality chains (the newest entries at
// scan time were McDonald's branches), while /visa-jobs is the editorial
// slice — sponsorship-vetted, mostly tech, and served as a schema.org
// ItemList in the page's own JSON-LD, so the adapter parses structured data
// rather than markup. Detail pages carry full JobPosting JSON-LD (6.9k-char
// description on the live sample), which desc:fill's generic lane reads.
//
// The site also publishes /companies/visa-sponsors — a curated list of
// Spanish sponsor companies. That is seed material for discovery, harvested
// by scripts/discovery/seed-curated.ts, not by this fetcher.

const BASE = "https://www.spainjobs.io";

export interface SpainJobsItem {
  title: string;
  company: string;
  url: string;
}

// ItemList entries name jobs as "{title} at {company}". Companies can contain
// " at " no more plausibly than titles can end with it, but splitting on the
// LAST occurrence is the safer read: titles carry qualifiers ("Engineer at
// scale") more often than company names start with prepositions.
export function parseSpainJobsList(html: string): SpainJobsItem[] {
  const out: SpainJobsItem[] = [];
  for (const m of html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    try {
      const data = JSON.parse(m[1]!);
      for (const node of Array.isArray(data) ? data : [data]) {
        if (node?.["@type"] !== "ItemList") continue;
        for (const item of node.itemListElement ?? []) {
          const name = String(item?.name ?? "");
          const url = String(item?.url ?? "");
          if (!name || !url.includes("/companies/")) continue;
          const cut = name.lastIndexOf(" at ");
          out.push({
            title: cut > 0 ? name.slice(0, cut).trim() : name,
            company: cut > 0 ? name.slice(cut + 4).trim() : "",
            url,
          });
        }
      }
    } catch { /* malformed block — next */ }
  }
  return out;
}

export function mapSpainJobsItem(i: SpainJobsItem): RawJob | null {
  if (!i.company) return null;
  const slug = i.url.split("/companies/")[1];
  if (!slug) return null;
  return {
    source: "spainjobsio",
    externalId: slug,
    url: i.url,
    title: i.title,
    company: i.company,
    location: "Spain",
    remote: /\bremote\b/i.test(i.title),
    description: `${i.title} at ${i.company} (Spain). Listed on SpainJobs.io's visa-sponsorship surface.`,
  };
}

export const spainjobsio: Source = {
  name: "spainjobsio",
  async fetch(): Promise<RawJob[]> {
    const html = await getText(`${BASE}/visa-jobs`);
    return parseSpainJobsList(html)
      .map(mapSpainJobsItem)
      .filter((j): j is RawJob => j !== null);
  },
};

/** The curated sponsor-company slugs, for the seeding lane. */
export async function fetchSpainSponsorCompanies(): Promise<string[]> {
  const html = await getText(`${BASE}/companies/visa-sponsors`);
  const names = new Set<string>();
  for (const m of html.matchAll(/href="\/companies\/([a-z0-9-]+)"/g)) {
    if (m[1] !== "visa-sponsors") names.add(m[1]!.replace(/-/g, " "));
  }
  return [...names];
}
