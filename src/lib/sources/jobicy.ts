import { getJSON, stripHtml, type RawJob, type Source } from "./types";

// Jobicy: remote jobs, no key, includes salary fields.
// https://jobicy.com/api/v2/remote-jobs
export const jobicy: Source = {
  name: "jobicy",
  async fetch(): Promise<RawJob[]> {
    const data = await getJSON("https://jobicy.com/api/v2/remote-jobs?count=100");
    return (data.jobs ?? []).map((j: any) => {
      const salary =
        j.salaryMin && j.salaryMax
          ? `${j.salaryCurrency ?? ""}${j.salaryMin}-${j.salaryMax}/${j.salaryPeriod ?? ""}`
          : undefined;
      return {
        source: "jobicy",
        externalId: String(j.id),
        url: j.url,
        title: j.jobTitle ?? "",
        company: j.companyName ?? "",
        location: j.jobGeo ?? "",
        remote: true,
        salaryText: salary,
        description: stripHtml(j.jobDescription || j.jobExcerpt),
        postedAt: j.pubDate ? new Date(j.pubDate) : undefined,
      };
    });
  },
};
