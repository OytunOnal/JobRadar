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
      remote: Boolean(j.isRemote) || String(j.locationType) === "1",
      // locationType is the employer's dropdown, decoded by correlation over
      // 23 boards: "1" rows carry no city at all (remote), "2" rows carry a
      // city plus flexibility (hybrid). "0" is 81% of rows and is the field's
      // resting state — a default, not an employer choosing onsite — so it
      // stays undefined. isRemote was null on every row observed.
      workMode: String(j.locationType) === "1" ? "remote" as const
        : String(j.locationType) === "2" ? "hybrid" as const : undefined,
      // List payload has no body; title-based scoring classifies these.
      description: String(j.jobOpeningName),
      postedAt: undefined,
    }));
}

export async function bamboohr(token: string, company: string): Promise<RawJob[]> {
  const data = await getJSON(`https://${token}.bamboohr.com/careers/list`);
  return mapBambooRows(data?.result, token, company);
}
