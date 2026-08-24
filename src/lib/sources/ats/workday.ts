import { postJSON, type RawJob } from "../types";

// Workday's job list gives only a relative "Posted X" string; turn it into an
// approximate date. "30+ Days Ago" is unbounded — treat as unknown rather
// than invent a date.
export function workdayPostedAt(postedOn: string | undefined, now = new Date()): Date | undefined {
  if (!postedOn) return undefined;
  const s = postedOn.toLowerCase();
  let days: number | undefined;
  if (s.includes("today")) days = 0;
  else if (s.includes("yesterday")) days = 1;
  else {
    const m = s.match(/(\d+)\+?\s*days?/);
    if (m) days = s.includes("+") ? undefined : Number(m[1]);
  }
  if (days === undefined) return undefined;
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - days);
  return d;
}

export function mapWorkdayPosting(p: any, ctx: { token: string; company: string; base: string; site: string }, now?: Date): RawJob {
  return {
    source: `workday:${ctx.token}`,
    externalId: String(p.bulletFields?.[0] ?? p.externalPath ?? ""),
    url: `${ctx.base}/${ctx.site}${p.externalPath ?? ""}`,
    title: p.title ?? "",
    company: ctx.company,
    location: p.locationsText ?? "",
    remote: /remote/i.test(`${p.locationsText ?? ""} ${p.title ?? ""}`),
    // List payload has no body; title-based scoring classifies these.
    description: p.title ?? "",
    postedAt: workdayPostedAt(p.postedOn, now),
  };
}

export async function workday(token: string, company: string): Promise<RawJob[]> {
  // Token is the canonical "tenant@wdN/site" triple (see discovery/platforms).
  const m = token.match(/^([^@]+)@(wd\d+)\/(.+)$/);
  if (!m) throw new Error(`workday: malformed token "${token}"`);
  const [, tenant, wd, site] = m;
  const base = `https://${tenant}.${wd}.myworkdayjobs.com`;
  const out: RawJob[] = [];
  const limit = 20;
  // Enterprise boards list thousands of postings; cap per ingest — keyword
  // scoring drops most of them anyway and the next run refreshes the window.
  const cap = 200;
  for (let offset = 0; offset < cap; offset += limit) {
    const data = await postJSON(`${base}/wday/cxs/${tenant}/${site}/jobs`, {
      limit,
      offset,
      searchText: "",
      appliedFacets: {},
    });
    const posts = data.jobPostings ?? [];
    for (const p of posts) out.push(mapWorkdayPosting(p, { token, company, base, site }));
    if (posts.length < limit || offset + limit >= (data.total ?? 0)) break;
  }
  return out;
}
