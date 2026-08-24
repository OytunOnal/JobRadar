import { getText, postJSON, type RawJob } from "../types";

// Getro VC-portfolio networks. Token = the board's host (jobs.b2venture.vc);
// the network id is bootstrapped from the page's __NEXT_DATA__. Jobs link to
// each employer's OWN ATS — high-value harvest input, modest as a source.

export function extractGetroNetworkId(html: string): string | null {
  return html.match(/"network"\s*:\s*\{\s*"id"\s*:\s*"?(\d+)"?/)?.[1] ?? null;
}

export function mapGetroJob(j: any, token: string, company: string): RawJob | null {
  if (!j?.id || !j?.title) return null;
  return {
    source: `getro:${token}`,
    externalId: String(j.id),
    url: String(j.url ?? ""),
    title: String(j.title).trim(),
    company: String(j.organization?.name ?? company),
    location: (j.locations ?? []).filter(Boolean).slice(0, 4).join("; "),
    remote: /remote/i.test(String(j.work_mode ?? "")),
    description: String(j.title),
    postedAt: j.created_at ? new Date(Number(j.created_at) * 1000) : undefined, // unix sec
  };
}

export async function getro(token: string, company: string): Promise<RawJob[]> {
  const html = await getText(`https://${token}/jobs`);
  const netId = extractGetroNetworkId(html);
  if (!netId) throw new Error(`getro:${token} -> no network id in __NEXT_DATA__`);
  const out: RawJob[] = [];
  for (let page = 0; page < 100; page++) {
    const res = await postJSON(`https://api.getro.com/api/v2/collections/${netId}/search/jobs`, {
      hitsPerPage: 20, page, filters: { page }, query: "",
    });
    const rows: any[] = res?.results?.jobs ?? [];
    for (const j of rows) {
      const job = mapGetroJob(j, token, company);
      if (job) out.push(job);
    }
    const total = Number(res?.results?.count ?? 0);
    if (rows.length === 0 || (page + 1) * 20 >= total) break;
  }
  return out;
}
