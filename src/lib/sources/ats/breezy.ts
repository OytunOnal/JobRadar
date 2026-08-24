import { getJSON, type RawJob } from "../types";

// Breezy: <tenant>.breezy.hr/json — top-level array with absolute posting
// URLs and a published date, no body.

export function mapBreezyRows(rows: any[], token: string, company: string): RawJob[] {
  const out: RawJob[] = [];
  for (const j of Array.isArray(rows) ? rows : []) {
    if (!j?.name || typeof j.url !== "string" || !j.url.startsWith("https://")) continue;
    const loc = j.location ?? {};
    const base = (typeof loc.name === "string" && loc.name.trim()) ||
      [loc.city, loc.state, loc.country?.name].filter(Boolean).join(", ");
    out.push({
      source: `breezy:${token}`,
      externalId: j.url.split("/").filter(Boolean).pop() ?? j.url,
      url: j.url,
      title: String(j.name),
      company,
      location: base,
      remote: Boolean(loc.is_remote),
      description: String(j.name), // no body in the list payload
      postedAt: j.published_date && !Number.isNaN(Date.parse(j.published_date))
        ? new Date(j.published_date)
        : undefined,
    });
  }
  return out;
}

export async function breezy(token: string, company: string): Promise<RawJob[]> {
  return mapBreezyRows(await getJSON(`https://${token}.breezy.hr/json`), token, company);
}
