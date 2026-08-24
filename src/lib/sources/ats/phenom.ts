import { postJSON, stripHtml, type RawJob } from "../types";

// Phenom. Every tenant on its own branded domain — token = that host
// (careers.allianz.com). Public /widgets POST, no auth. Curated-only: no
// common host to pattern-match in discovery.

export function mapPhenomJob(j: any, token: string, company: string): RawJob | null {
  if (!j?.reqId && !j?.jobId) return null;
  const locs = [j.city, ...(j.multi_location ?? [])].filter(Boolean);
  return {
    source: `phenom:${token}`,
    externalId: String(j.reqId ?? j.jobId),
    url: String(j.applyUrl ?? ""),
    title: String(j.title ?? "").trim(),
    company,
    location: [...new Set(locs)].slice(0, 4).join("; "),
    remote: Boolean(j.remote) || /remote/i.test(String(j.type ?? "")),
    // The teaser is cut from the same rich-text field the JD page renders, so
    // it arrives with markup like every other body here. It was the one body
    // field in this layer assigned raw.
    description: stripHtml(String(j.descriptionTeaser ?? "")) || String(j.title ?? ""),
    postedAt: j.postedDate ? new Date(j.postedDate) : undefined,
  };
}

// Fourteen lines of widget payload that have to be exactly right.
export function phenomQuery(from: number, size: number): object {
  return {
    lang: "en_global", deviceType: "desktop", country: "global",
    pageName: "search-results", ddoKey: "refineSearch", sortBy: "",
    subsearch: "", from, jobs: true, counts: true,
    all_fields: ["category", "country", "city"], size, clearAll: false,
    jdsource: "facets", isSliderEnable: false, pageId: "page10",
    siteType: "external", keywords: "", global: true,
    selected_fields: {}, locationData: {},
  };
}

export async function phenom(token: string, company: string): Promise<RawJob[]> {
  const out: RawJob[] = [];
  const SIZE = 100;
  for (let from = 0; from < 3000; from += SIZE) {
    const res = await postJSON(`https://${token}/widgets`, phenomQuery(from, SIZE));
    const rs = res?.refineSearch;
    const rows: any[] = rs?.data?.jobs ?? [];
    for (const j of rows) {
      const job = mapPhenomJob(j, token, company);
      if (job) out.push(job);
    }
    const total = Number(rs?.totalHits ?? 0);
    if (rows.length === 0 || from + SIZE >= total) break;
  }
  return out;
}
