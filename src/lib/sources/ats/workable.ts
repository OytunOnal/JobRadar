import { getJSON, type RawJob } from "../types";

export function mapWorkableJob(j: any, token: string, company: string, boardName?: string): RawJob {
  return {
    source: `workable:${token}`,
    externalId: String(j.shortcode ?? j.code ?? j.url),
    url: j.url ?? j.application_url ?? "",
    title: j.title ?? "",
    company: boardName || company,
    location: [j.city, j.country].filter(Boolean).join(", "),
    remote: Boolean(j.telecommuting),
    // telecommuting is a statement when true; false is a default, not an
    // employer choosing onsite.
    workMode: j.telecommuting === true ? "remote" as const : undefined,
    // The widget listing has no body text; title-based scoring classifies
    // these (same trade-off as SmartRecruiters).
    description: j.title ?? "",
    postedAt: j.published_on ? new Date(j.published_on) : undefined,
  };
}

export async function workable(token: string, company: string): Promise<RawJob[]> {
  // Widget API: single unauthenticated GET, case-sensitive lowercase slug.
  const data = await getJSON(
    `https://apply.workable.com/api/v1/widget/accounts/${token}`,
  );
  return (data.jobs ?? []).map((j: any) => mapWorkableJob(j, token, company, data.name));
}
