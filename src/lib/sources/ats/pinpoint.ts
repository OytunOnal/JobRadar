import { getJSON, stripHtml, type RawJob } from "../types";

// Pinpoint: /postings.json — rich payload (description AND compensation).

export function mapPinpointRows(rows: any[], token: string, company: string): RawJob[] {
  const out: RawJob[] = [];
  for (const j of Array.isArray(rows) ? rows : []) {
    const url = typeof j?.url === "string" && j.url.startsWith("https://") ? j.url : "";
    if (!j?.title || !url) continue;
    const loc = j.location ?? {};
    out.push({
      source: `pinpoint:${token}`,
      externalId: String(j.id ?? url),
      url,
      title: String(j.title).trim(),
      company,
      location: (typeof loc.name === "string" && loc.name.trim()) ||
        [loc.city, loc.province].filter(Boolean).join(", "),
      remote: /remote/i.test(`${j.workplace_type ?? ""} ${loc.name ?? ""}`),
      salaryText: j.compensation ? String(j.compensation) : undefined,
      description: stripHtml(j.description ?? "") || String(j.title),
      postedAt: undefined,
    });
  }
  return out;
}

export async function pinpoint(token: string, company: string): Promise<RawJob[]> {
  const data = await getJSON(`https://${token}.pinpointhq.com/postings.json`);
  return mapPinpointRows(data?.data, token, company);
}
