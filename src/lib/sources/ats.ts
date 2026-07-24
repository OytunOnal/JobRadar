import { getJSON, stripHtml, type RawJob } from "./types";

// Generic connectors for the major applicant-tracking systems. Each takes a
// company's board token and returns that company's postings, normalized.
// These are the highest-signal sources: you choose exactly which companies to
// watch (see companies.ts) instead of filtering a firehose.

export async function greenhouse(token: string, company: string): Promise<RawJob[]> {
  const data = await getJSON(
    `https://boards-api.greenhouse.io/v1/boards/${token}/jobs?content=true`,
  );
  return (data.jobs ?? []).map((j: any) => ({
    source: `gh:${token}`,
    externalId: String(j.id),
    url: j.absolute_url,
    title: j.title ?? "",
    company,
    location: j.location?.name ?? "",
    remote: /remote/i.test(j.location?.name ?? ""),
    description: stripHtml(j.content),
    postedAt: j.updated_at ? new Date(j.updated_at) : undefined,
  }));
}

export async function lever(token: string, company: string): Promise<RawJob[]> {
  const data = await getJSON(`https://api.lever.co/v0/postings/${token}?mode=json`);
  return (Array.isArray(data) ? data : []).map((j: any) => ({
    source: `lever:${token}`,
    externalId: String(j.id),
    url: j.hostedUrl,
    title: j.text ?? "",
    company,
    location: j.categories?.location ?? "",
    remote: /remote/i.test(j.categories?.location ?? "") || /remote/i.test(j.workplaceType ?? ""),
    description: j.descriptionPlain ?? stripHtml(j.description),
    postedAt: j.createdAt ? new Date(j.createdAt) : undefined,
  }));
}

export async function ashby(token: string, company: string): Promise<RawJob[]> {
  const data = await getJSON(`https://api.ashbyhq.com/posting-api/job-board/${token}`);
  return (data.jobs ?? []).map((j: any) => ({
    source: `ashby:${token}`,
    externalId: String(j.id ?? j.jobUrl),
    url: j.jobUrl ?? j.applyUrl ?? "",
    title: j.title ?? "",
    company,
    location: j.location ?? j.locationName ?? "",
    remote: Boolean(j.isRemote) || /remote/i.test(j.location ?? ""),
    description: j.descriptionPlain ?? stripHtml(j.descriptionHtml ?? j.description),
    postedAt: j.publishedAt ? new Date(j.publishedAt) : undefined,
  }));
}

export async function smartrecruiters(token: string, company: string): Promise<RawJob[]> {
  const data = await getJSON(
    `https://api.smartrecruiters.com/v1/companies/${token}/postings?limit=100`,
  );
  return (data.content ?? []).map((j: any) => {
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
  });
}

export const atsFetchers = { greenhouse, lever, ashby, smartrecruiters } as const;
export type AtsProvider = keyof typeof atsFetchers;
