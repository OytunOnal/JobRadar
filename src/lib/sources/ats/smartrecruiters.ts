import { getJSON, type RawJob } from "../types";

// The list endpoint omits `jobAd`, which is where SmartRecruiters keeps the
// posting split into named blocks — companyDescription, jobDescription,
// qualifications, additionalInformation. desc:fill fetches that per posting
// and assembles it; here the title is all there is.
export function mapSmartRecruitersJob(j: any, token: string, company: string): RawJob {
  const loc = j.location
    ? [j.location.city, j.location.country].filter(Boolean).join(", ")
    : "";
  return {
    source: `sr:${token}`,
    externalId: String(j.id),
    url: `https://jobs.smartrecruiters.com/${token}/${j.id}`,
    title: j.name ?? "",
    company,
    location: loc,
    remote: Boolean(j.location?.remote),
    // Postings list has no body; title-based scoring still classifies these.
    description: j.name ?? "",
    postedAt: j.releasedDate ? new Date(j.releasedDate) : undefined,
  };
}

export async function smartrecruiters(token: string, company: string): Promise<RawJob[]> {
  const data = await getJSON(
    `https://api.smartrecruiters.com/v1/companies/${token}/postings?limit=100`,
  );
  return (data.content ?? []).map((j: any) => mapSmartRecruitersJob(j, token, company));
}
