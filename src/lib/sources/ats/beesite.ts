import { getJSON, type RawJob } from "../types";

// BeeSite (milch & zucker) — German enterprise boards (Mercedes-Benz).
// Token = backend subdomain of app.beesite.de; job URLs point at the branded
// career site. Live-verified 2026-08-21: 2,951 postings on Mercedes.

export function mapBeesiteItem(it: any, token: string, company: string): RawJob | null {
  const d = it?.MatchedObjectDescriptor;
  if (!d?.PositionID || !d?.PositionTitle) return null;
  const locs = (Array.isArray(d.PositionLocation) ? d.PositionLocation : [d.PositionLocation])
    .filter(Boolean)
    .map((l: any) => [l.CityName, l.CountryName].filter(Boolean).join(", "))
    .filter(Boolean)
    .join("; ");
  return {
    source: `beesite:${token}`,
    externalId: String(d.PositionID),
    url: String(d.PositionURI ?? ""),
    title: String(d.PositionTitle).trim(),
    company,
    location: locs,
    remote: /remote|home\s*office/i.test(`${d.PositionTitle} ${locs}`),
    description: String(d.PositionTitle), // list carries no body
    postedAt: d.PublicationStartDate ? new Date(d.PublicationStartDate) : undefined,
  };
}

// The search envelope is 15 lines of nested JSON that has to be exactly right;
// building it here rather than inline keeps it readable and checkable.
export function beesiteQuery(first: number, count: number): string {
  return JSON.stringify({
    LanguageCode: "EN",
    SearchParameters: {
      FirstItem: first,
      CountItem: count,
      Sort: [{ Criterion: "PublicationStartDate", Direction: "DESC" }],
      MatchedObjectDescriptor: [
        "PositionID", "PositionTitle", "PositionURI",
        "PositionLocation.CityName", "PositionLocation.CountryName",
        "PublicationStartDate",
      ],
    },
    SearchCriteria: [],
  });
}

export async function beesite(token: string, company: string): Promise<RawJob[]> {
  const out: RawJob[] = [];
  const COUNT = 200;
  for (let first = 1; first <= 6000; first += COUNT) {
    const res = await getJSON(
      `https://${token}.app.beesite.de/search?data=${encodeURIComponent(beesiteQuery(first, COUNT))}`,
    );
    const items: any[] = res?.SearchResult?.SearchResultItems ?? [];
    for (const it of items) {
      const job = mapBeesiteItem(it, token, company);
      if (job) out.push(job);
    }
    const total = Number(res?.SearchResult?.SearchResultCountAll ?? 0);
    if (first + COUNT > total || items.length === 0) break;
  }
  return out;
}
