import { stripHtml, type RawJob, type Source } from "./types";

// Alfreð (alfred.is) — Iceland's dominant board. The Nordics scan (#28,
// docs/scan-parts/iceland.md) found the honest ceiling: robots bans /api/
// and pagination is client-side, so we cannot sweep — but the /en landing
// page embeds ~27 complete job objects (body included) in __NEXT_DATA__,
// one keyless, robots-legal fetch. So this is a page-one poller, not a
// crawler, and Iceland is a thin market where that is enough — the file in
// the scan says so with numbers.
//
// Full objects means no detail fetch and no desc:fill: the embedded
// description is the body.

const UA = "JobRadar/0.1 (personal job search)";

export function extractNextData(html: string): any | null {
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) return null;
  try { return JSON.parse(m[1]!); } catch { return null; }
}

// The jobs array is nested somewhere under props; find it structurally (an
// array of objects with a title and a slug) rather than pinning a path that
// a Next.js version bump would move.
export function findJobsArray(node: any, depth = 0): any[] | null {
  if (depth > 6 || !node || typeof node !== "object") return null;
  for (const v of Object.values(node)) {
    if (Array.isArray(v) && v.length > 3 && v[0]?.title && v[0]?.slug) return v;
    const found = findJobsArray(v, depth + 1);
    if (found) return found;
  }
  return null;
}

export function mapAlfredJob(j: any): RawJob | null {
  const id = j?.id ?? j?.slug;
  const title = String(j?.title ?? "").trim();
  if (!id || !title || j?.expired) return null;
  const types: string[] = Array.isArray(j?.jobTypes) ? j.jobTypes : [];
  return {
    source: "alfred",
    externalId: String(id),
    url: `https://alfred.is/job/${id}`,
    title,
    company: String(j?.brand?.name ?? "").trim() || "?",
    location: "Iceland",
    remote: /\bremote\b|fjarvinn/i.test(`${title} ${types.join(" ")}`),
    description: stripHtml(String(j?.description ?? "")) || title,
    postedAt: j?.published && !Number.isNaN(Date.parse(j.published)) ? new Date(j.published) : undefined,
  };
}

export const alfred: Source = {
  name: "alfred",
  async fetch(): Promise<RawJob[]> {
    const res = await fetch("https://alfred.is/en", {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`alfred.is -> HTTP ${res.status}`);
    const data = extractNextData(await res.text());
    const arr = data ? findJobsArray(data.props ?? data) : null;
    if (!arr) return [];
    return arr.map(mapAlfredJob).filter((j): j is RawJob => j !== null);
  },
};
