import { getJSON, type RawJob } from "../types";

// BambooHR: /careers/list JSON — lightweight metadata (no body, no dates).
// Shape: { result: [{ id, jobOpeningName, location: {city, state}, isRemote }] }

export function mapBambooRows(rows: any[], token: string, company: string): RawJob[] {
  return (Array.isArray(rows) ? rows : [])
    .filter((j) => j?.jobOpeningName && String(j.id ?? "").trim())
    .map((j) => ({
      source: `bamboohr:${token}`,
      externalId: String(j.id),
      url: `https://${token}.bamboohr.com/careers/${encodeURIComponent(String(j.id))}`,
      title: String(j.jobOpeningName),
      company,
      location: [j.location?.city, j.location?.state].filter(Boolean).join(", "),
      remote: Boolean(j.isRemote),
      // List payload has no body; title-based scoring classifies these.
      description: String(j.jobOpeningName),
      postedAt: undefined,
    }));
}

export async function bamboohr(token: string, company: string): Promise<RawJob[]> {
  const data = await getJSON(`https://${token}.bamboohr.com/careers/list`);
  return mapBambooRows(data?.result, token, company);
}
