import { getJSON, stripHtml, type RawJob, type Source } from "./types";

// Himalayas: remote jobs, no key, salary + location-restriction data.
// https://himalayas.app/jobs/api
export const himalayas: Source = {
  name: "himalayas",
  async fetch(): Promise<RawJob[]> {
    const data = await getJSON("https://himalayas.app/jobs/api?limit=100");
    return (data.jobs ?? []).map((j: any) => {
      const salary =
        j.minSalary && j.maxSalary
          ? `${j.currency ?? ""}${j.minSalary}-${j.maxSalary}/${j.salaryPeriod ?? ""}`
          : undefined;
      const loc = Array.isArray(j.locationRestrictions)
        ? j.locationRestrictions.join(", ")
        : "";
      return {
        source: "himalayas",
        externalId: String(j.guid),
        url: j.applicationLink || j.guid,
        title: j.title ?? "",
        company: j.companyName ?? "",
        location: loc || "Remote",
        remote: true,
        salaryText: salary,
        description: stripHtml(j.description || j.excerpt),
        postedAt: j.pubDate ? new Date(j.pubDate) : undefined,
      };
    });
  },
};
