import { getJSON, stripHtml, type RawJob } from "../types";

// Greenhouse — the largest single ATS source in this pool, and the one whose
// content arrives HTML-ENCODED. That is not trivia: the old converter stripped
// tags before decoding entities, so the tag regex matched nothing and the
// decode step then MANIFESTED markup into the stored text. 47-58% of a stored
// Greenhouse description was `<span style=…>` (see html-text.ts). There was no
// test that could have caught it, because the mapping lived inside the fetch.

export function mapGreenhouseJob(j: any, token: string, company: string): RawJob {
  return {
    source: `gh:${token}`,
    externalId: String(j.id),
    url: j.absolute_url,
    title: j.title ?? "",
    company,
    location: j.location?.name ?? "",
    remote: /remote/i.test(j.location?.name ?? ""),
    description: stripHtml(j.content),
    postedAt: j.updated_at ? new Date(j.updated_at) : undefined,
  };
}

export async function greenhouse(token: string, company: string): Promise<RawJob[]> {
  const data = await getJSON(
    `https://boards-api.greenhouse.io/v1/boards/${token}/jobs?content=true`,
  );
  return (data.jobs ?? []).map((j: any) => mapGreenhouseJob(j, token, company));
}
