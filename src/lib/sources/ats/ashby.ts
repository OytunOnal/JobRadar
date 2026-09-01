import { getJSON, stripHtml, type RawJob } from "../types";

export function mapAshbyJob(j: any, token: string, company: string): RawJob {
  return {
    source: `ashby:${token}`,
    externalId: String(j.id ?? j.jobUrl),
    url: j.jobUrl ?? j.applyUrl ?? "",
    title: j.title ?? "",
    company,
    location: j.location ?? j.locationName ?? "",
    remote: Boolean(j.isRemote) || /remote/i.test(j.location ?? ""),
    // The employer's own dropdown, shipped as "Remote" | "Hybrid" | "Onsite".
    // This adapter read only isRemote for years, which meant the strongest
    // statement any source makes about the arrangement — on 16% of the pool —
    // was thrown away at the door and a text scan guessed in its place.
    workMode: j.workplaceType === "Remote" ? "remote" as const
      : j.workplaceType === "Hybrid" ? "hybrid" as const
      : j.workplaceType === "Onsite" ? "onsite" as const : undefined,
    // HTML first: `descriptionPlain` is the same text with its headings and
    // bullets flattened away, and the section parser needs that structure.
    description: stripHtml(j.descriptionHtml ?? j.description) || String(j.descriptionPlain ?? ""),
    postedAt: j.publishedAt ? new Date(j.publishedAt) : undefined,
  };
}

export async function ashby(token: string, company: string): Promise<RawJob[]> {
  const data = await getJSON(`https://api.ashbyhq.com/posting-api/job-board/${token}`);
  return (data.jobs ?? []).map((j: any) => mapAshbyJob(j, token, company));
}
