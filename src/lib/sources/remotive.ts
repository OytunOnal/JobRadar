import { getJSON, stripHtml, type RawJob, type Source } from "./types";

// Remotive: large remote board. Its `search` param is unreliable, so we pull
// the software-dev + design categories broadly and let scoring filter.
// https://remotive.com/api/remote-jobs
export const remotive: Source = {
  name: "remotive",
  async fetch(): Promise<RawJob[]> {
    const categories = ["software-dev", "design", "all-others"];
    const out: RawJob[] = [];
    for (const cat of categories) {
      try {
        const data = await getJSON(
          `https://remotive.com/api/remote-jobs?category=${cat}&limit=200`,
        );
        for (const j of data.jobs ?? []) {
          out.push({
            source: "remotive",
            externalId: String(j.id),
            url: j.url,
            title: j.title ?? "",
            company: j.company_name ?? "",
            location: j.candidate_required_location ?? "",
            remote: true,
            salaryText: j.salary || undefined,
            description: stripHtml(j.description),
            postedAt: j.publication_date ? new Date(j.publication_date) : undefined,
          });
        }
      } catch {
        // one bad category shouldn't sink the whole source
      }
    }
    return out;
  },
};
