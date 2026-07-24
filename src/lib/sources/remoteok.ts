import { getJSON, stripHtml, type RawJob, type Source } from "./types";

// RemoteOK: first array element is metadata, rest are jobs.
// https://remoteok.com/api
export const remoteok: Source = {
  name: "remoteok",
  async fetch(): Promise<RawJob[]> {
    const data = await getJSON("https://remoteok.com/api");
    const jobs: any[] = Array.isArray(data) ? data.slice(1) : [];
    return jobs.map((j) => ({
      source: "remoteok",
      externalId: String(j.id ?? j.slug),
      url: j.url ?? j.apply_url ?? "",
      title: j.position ?? j.title ?? "",
      company: j.company ?? "",
      location: j.location ?? "Remote",
      remote: true,
      salaryText:
        j.salary_min && j.salary_max
          ? `$${j.salary_min}-${j.salary_max}`
          : undefined,
      description: stripHtml(j.description),
      postedAt: j.date ? new Date(j.date) : undefined,
    }));
  },
};
