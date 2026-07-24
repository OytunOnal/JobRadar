import { getJSON, stripHtml, type RawJob, type Source } from "./types";

// Arbeitnow: EU-focused board, clean JSON, returns ~100 recent jobs.
// https://www.arbeitnow.com/api/job-board-api
export const arbeitnow: Source = {
  name: "arbeitnow",
  async fetch(): Promise<RawJob[]> {
    const data = await getJSON("https://www.arbeitnow.com/api/job-board-api");
    const jobs: any[] = data.data ?? [];
    return jobs.map((j) => ({
      source: "arbeitnow",
      externalId: String(j.slug),
      url: j.url,
      title: j.title ?? "",
      company: j.company_name ?? "",
      location: j.location ?? "",
      remote: Boolean(j.remote),
      description: stripHtml(j.description),
      postedAt: j.created_at ? new Date(j.created_at * 1000) : undefined,
    }));
  },
};
