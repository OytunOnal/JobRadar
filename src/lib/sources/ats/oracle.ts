import { getJSON, type RawJob } from "../types";

// Oracle Cloud Recruiting (ORC). Token is structured like Workday's:
// "<hostPrefix>@<siteNumber>" — e.g. "eeho.fa.us2@CX_45001" for
// eeho.fa.us2.oraclecloud.com. The CE REST API is public JSON, paginated via
// limit/offset INSIDE the finder string. Live-verified quirk: an unknown
// siteNumber does NOT error — the API silently falls back to the default
// site — so liveness means "requisitionList is non-empty", never status 200.

export function mapOracleReq(j: any, ctx: { token: string; company: string; host: string; site: string }): RawJob | null {
  if (!j?.Id || !j?.Title) return null;
  const secondary = (j.secondaryLocations ?? [])
    .map((s: any) => s?.Name)
    .filter(Boolean)
    .join("; ");
  return {
    source: `oracle:${ctx.token}`,
    externalId: String(j.Id),
    url: `https://${ctx.host}/hcmUI/CandidateExperience/en/sites/${ctx.site}/job/${j.Id}`,
    title: String(j.Title).trim(),
    company: ctx.company,
    location: [j.PrimaryLocation, secondary].filter(Boolean).join("; "),
    remote: /remote/i.test(`${j.WorkplaceType ?? ""} ${j.PrimaryLocation ?? ""}`),
    // ShortDescriptionStr is a real summary (not a title echo); the full body
    // lives behind the details endpoint (desc-fill territory). Oracle names
    // its blocks, so they travel as sections.
    sections: [
      ["", j.ShortDescriptionStr],
      ["Responsibilities", j.ExternalResponsibilitiesStr],
      ["Requirements", j.ExternalQualificationsStr],
    ],
    description: String(j.Title),
    postedAt: j.PostedDate ? new Date(j.PostedDate) : undefined,
  };
}

export async function oracle(token: string, company: string): Promise<RawJob[]> {
  const m = token.match(/^([a-z0-9.-]+)@(.+)$/i);
  if (!m) return [];
  const host = `${m[1]}.oraclecloud.com`;
  const site = m[2];
  const out: RawJob[] = [];
  const LIMIT = 200;
  for (let offset = 0; offset < 3000; offset += LIMIT) {
    const url =
      `https://${host}/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true` +
      `&expand=requisitionList.secondaryLocations` +
      `&finder=findReqs;siteNumber=${encodeURIComponent(site)},limit=${LIMIT},offset=${offset},sortBy=POSTING_DATES_DESC`;
    const data = await getJSON(url);
    const item = data?.items?.[0];
    const reqs: any[] = Array.isArray(item?.requisitionList) ? item.requisitionList : [];
    for (const j of reqs) {
      const job = mapOracleReq(j, { token, company, host, site });
      if (job) out.push(job);
    }
    const total = Number(item?.TotalJobsCount ?? 0);
    if (offset + LIMIT >= total || reqs.length === 0) break;
  }
  return out;
}
