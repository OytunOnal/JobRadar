import { type RawJob } from "../types";

// Cornerstone (CSOD). Token = "<sub>@<siteId>" (career-ohb@4); corp name
// defaults to the subdomain. Two-step: scrape the anonymous JWT (+ cookies)
// off the career-site home page, then POST the search API with both.

// The bootstrap regex, split out because it is the fragile half of this
// connector and the half no network is needed to check.
export function extractCsodJwt(html: string): string | null {
  return html.match(/"token"\s*:\s*"([A-Za-z0-9._-]+)"/)?.[1] ?? null;
}

export function mapCsodRequisition(j: any, ctx: { token: string; company: string; origin: string; siteId: string; sub: string }): RawJob | null {
  if (!j?.requisitionId) return null;
  const locs = (j.locations ?? [])
    .map((l: any) => [l.city, l.state, l.country].filter(Boolean).join(", "))
    .filter(Boolean)
    .join("; ");
  return {
    source: `csod:${ctx.token}`,
    externalId: String(j.requisitionId),
    url: `${ctx.origin}/ux/ats/careersite/${ctx.siteId}/home/requisition/${j.requisitionId}?c=${ctx.sub}`,
    title: String(j.displayJobTitle ?? "").trim(),
    company: ctx.company,
    location: locs,
    remote: /remote/i.test(`${j.displayJobTitle} ${locs}`),
    description: String(j.displayJobTitle ?? ""),
    postedAt: j.postingEffectiveDate ? new Date(j.postingEffectiveDate) : undefined,
  };
}

export async function csod(token: string, company: string): Promise<RawJob[]> {
  const m = token.match(/^([^@]+)@(\d+)$/);
  if (!m) return [];
  const [, sub, siteId] = m;
  const origin = `https://${sub}.csod.com`;
  const homeRes = await fetch(`${origin}/ux/ats/careersite/${siteId}/home?c=${sub}`, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; JobRadar/0.1)" },
    signal: AbortSignal.timeout(30_000),
  });
  const jwt = extractCsodJwt(await homeRes.text());
  if (!jwt) throw new Error(`csod:${token} -> no anonymous token on home page`);
  const cookies = homeRes.headers.get("set-cookie") ?? "";
  const out: RawJob[] = [];
  for (let page = 1; page <= 60; page++) {
    const res = await fetch(`${origin}/services/x/career-site/v1/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${jwt}`,
        Cookie: cookies.split(",").map((c) => c.split(";")[0]).join("; "),
        "User-Agent": "Mozilla/5.0 (compatible; JobRadar/0.1)",
      },
      body: JSON.stringify({
        careerSiteId: Number(siteId), careerSitePageId: Number(siteId),
        pageNumber: page, pageSize: 50, cultureId: 1, cultureName: "en-US",
        searchText: "", states: [], countryCodes: [], cities: [], placeID: "",
        radius: null, postingsWithinDays: null, customFieldCheckboxKeys: [],
        customFieldDropdowns: [], customFieldRadios: [],
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`csod:${token} search -> HTTP ${res.status}`);
    const data = await res.json();
    const rows: any[] = data?.data?.requisitions ?? [];
    for (const j of rows) {
      const job = mapCsodRequisition(j, { token, company, origin, siteId, sub });
      if (job) out.push(job);
    }
    const total = Number(data?.data?.totalCount ?? 0);
    if (rows.length === 0 || page * 50 >= total) break;
  }
  return out;
}
