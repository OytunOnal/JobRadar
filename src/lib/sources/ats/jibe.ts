import { getJSON, stripHtml, type RawJob } from "../types";

// JibeApply (iCIMS' career-site layer). Token = subdomain (nfiindustries).
// Clean public JSON with FULL descriptions — also the practical route into
// iCIMS tenants, whose own portals sit behind an AWS WAF.

export function mapJibeRow(row: any, token: string, company: string): RawJob | null {
  const j = row?.data ?? row;
  if (!j?.title) return null;
  return {
    source: `jibe:${token}`,
    externalId: String(j.req_id ?? j.slug ?? ""),
    url: String(j.apply_url ?? `https://${token}.jibeapply.com/jobs/${j.slug ?? ""}`),
    title: String(j.title).trim(),
    company,
    location: String(j.full_location ?? j.location_name ?? ""),
    remote: /remote/i.test(`${j.title} ${j.full_location ?? ""}`),
    description: stripHtml(String(j.description ?? "")) || String(j.title),
    postedAt: j.posted_date ? new Date(j.posted_date) : undefined,
  };
}

export async function jibe(token: string, company: string): Promise<RawJob[]> {
  const out: RawJob[] = [];
  for (let page = 1; page <= 150; page++) {
    const data = await getJSON(`https://${token}.jibeapply.com/api/jobs?page=${page}`);
    const rows: any[] = data?.jobs ?? [];
    for (const row of rows) {
      const job = mapJibeRow(row, token, company);
      if (job) out.push(job);
    }
    const total = Number(data?.totalCount ?? 0);
    if (rows.length === 0 || page * 10 >= total) break;
  }
  return out;
}
