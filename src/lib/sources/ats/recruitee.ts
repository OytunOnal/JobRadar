import { getJSON, stripHtml, type RawJob } from "../types";

export function mapRecruiteeOffer(o: any, token: string, company: string): RawJob {
  return {
    source: `recruitee:${token}`,
    externalId: String(o.id ?? o.guid),
    url: o.careers_url ?? "",
    title: o.title ?? "",
    company: o.company_name || company,
    location: [o.city, o.country].filter(Boolean).join(", "),
    remote: Boolean(o.remote),
    workMode: o.remote ? "remote" as const : o.hybrid ? "hybrid" as const : undefined,
    description: stripHtml(o.description ?? "") || (o.title ?? ""),
    postedAt: o.published_at
      ? new Date(o.published_at)
      : o.created_at
        ? new Date(o.created_at)
        : undefined,
  };
}

export async function recruitee(token: string, company: string): Promise<RawJob[]> {
  // Public offers API on the company's subdomain; unknown subdomains 404.
  const data = await getJSON(`https://${token}.recruitee.com/api/offers/`);
  return (data.offers ?? []).map((o: any) => mapRecruiteeOffer(o, token, company));
}
