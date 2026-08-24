import { getJSON, type RawJob } from "../types";

// Rippling ATS. Token = board slug. One row PER LOCATION with the same uuid
// (live-verified) — rows are merged here. No posted date anywhere.

export function mapRipplingRows(rows: any[], token: string, company: string): RawJob[] {
  const byId = new Map<string, RawJob>();
  for (const j of Array.isArray(rows) ? rows : []) {
    if (!j?.uuid || !j?.name) continue;
    const loc = j.workLocation?.label ?? "";
    const prev = byId.get(String(j.uuid));
    if (prev) {
      if (loc && !(prev.location ?? "").includes(loc)) prev.location = [prev.location, loc].filter(Boolean).join("; ");
      continue;
    }
    byId.set(String(j.uuid), {
      source: `rippling:${token}`,
      externalId: String(j.uuid),
      url: String(j.url ?? `https://ats.rippling.com/${token}/jobs/${j.uuid}`),
      title: String(j.name).trim(),
      company,
      location: loc,
      remote: /remote/i.test(`${j.name} ${loc}`),
      description: String(j.name), // body lives on the detail endpoint
      postedAt: undefined,
    });
  }
  return [...byId.values()];
}

export async function rippling(token: string, company: string): Promise<RawJob[]> {
  const data = await getJSON(`https://api.rippling.com/platform/api/ats/v1/board/${token}/jobs`);
  return mapRipplingRows(data, token, company);
}
