import { getJSON, stripHtml, type RawJob, type Source } from "./types";

// Jobicy: remote jobs, no key, includes salary fields. The API caps count at
// 100 per request with no pagination — so one broad pull plus per-industry
// pulls, deduped, is how you get past the cap.
// https://jobicy.com/api/v2/remote-jobs
const INDUSTRIES = (process.env.JOBICY_INDUSTRIES ||
  "dev,engineering,data-science,product,design-multimedia,management")
  .split(",").map((s) => s.trim()).filter(Boolean);

export const jobicy: Source = {
  name: "jobicy",
  async fetch(): Promise<RawJob[]> {
    const out: RawJob[] = [];
    const seen = new Set<string>();
    for (const industry of ["", ...INDUSTRIES]) {
      let data: any;
      try {
        data = await getJSON(
          `https://jobicy.com/api/v2/remote-jobs?count=100${industry ? `&industry=${industry}` : ""}`,
        );
      } catch {
        continue; // one bad industry shouldn't sink the source
      }
      for (const job of (data.jobs ?? []).map(mapJob)) {
        if (seen.has(job.externalId)) continue;
        seen.add(job.externalId);
        out.push(job);
      }
    }
    return out;
  },
};

function mapJob(j: any): RawJob {
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
}
