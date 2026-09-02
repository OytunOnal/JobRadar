import { getJSON, stripHtml, type RawJob } from "../types";

// Manatal — client boards hosted at www.careers-page.com/{slug}, with an
// official public JSON API (developers.manatal.com), found by the 2026-09
// market scan. The list payload carries the FULL description, so unlike most
// list endpoints these postings arrive readable — no desc:fill debt.
//
// Tenant base is agency-heavy (the verified example, lifelancer, lists 9k+
// postings on other companies' behalf), so the page cap matters twice: it
// bounds politeness AND keeps one mega-agency from flooding an ingest. The
// ghost-risk detector's "our client" signal earns its keep here.

const PAGE_SIZE = 50;
const MAX_PAGES = Number(process.env.MANATAL_MAX_PAGES) || 4;

export function mapManatalJob(j: any, token: string, company: string): RawJob | null {
  const hash = String(j?.hash ?? "").trim();
  const title = String(j?.position_name ?? "").trim();
  if (!hash || !title) return null;
  const location = [j.location_display, [j.city, j.state, j.country].filter(Boolean).join(", "), j.address]
    .map((s: unknown) => String(s ?? "").trim())
    .find(Boolean) ?? "";
  return {
    source: `manatal:${token}`,
    externalId: hash,
    url: `https://www.careers-page.com/${token}/job/${hash}`,
    title,
    company,
    location,
    remote: /\bremote\b/i.test(`${location} ${title}`),
    description: stripHtml(String(j.description ?? "")) || title,
    // The API dates nothing; firstSeenAt carries freshness, as with Breezy.
  };
}

export async function manatal(token: string, company: string): Promise<RawJob[]> {
  const out: RawJob[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const data = await getJSON(
      `https://www.careers-page.com/api/v1.0/c/${encodeURIComponent(token)}/jobs/?page=${page}&page_size=${PAGE_SIZE}`,
    );
    for (const j of data?.results ?? []) {
      const job = mapManatalJob(j, token, company);
      if (job) out.push(job);
    }
    if (!data?.next) break;
  }
  return out;
}
