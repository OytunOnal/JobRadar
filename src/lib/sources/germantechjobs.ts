import { type RawJob, type Source } from "./types";

// GermanTechJobs — same board engine as SwissDevJobs (found via
// awesome-job-boards sweep), so the connector mirrors swissdevjobs.ts:
// /api/jobsLight is the live endpoint, one request for the whole board
// (~800 jobs), with STRUCTURED hasVisaSponsorship — gold for a
// Germany-focused visa search.

const API_URL = "https://germantechjobs.de/api/jobsLight";
const UA = "Mozilla/5.0 (compatible; JobRadar/0.1; personal job search)";

const WORK_MODES = new Set(["remote", "hybrid", "onsite"]);

export function mapGermanTechJob(j: any): RawJob | null {
  if (!j?._id || !j?.name || j?.isPaused) return null;
  const salary =
    j.annualSalaryFrom != null
      ? `${j.annualSalaryFrom}–${j.annualSalaryTo ?? j.annualSalaryFrom} EUR`
      : undefined;
  const workplace = String(j.workplace ?? "").toLowerCase();
  const workMode = WORK_MODES.has(workplace) ? (workplace as RawJob["workMode"]) : undefined;
  const visa =
    j.hasVisaSponsorship === "Yes" ? "yes" : j.hasVisaSponsorship === "No" ? "no" : undefined;
  const description = [
    `${j.expLevel ?? ""} ${j.name} at ${j.company ?? "?"} (${j.actualCity ?? "Germany"}).`,
    Array.isArray(j.technologies) && j.technologies.length ? `Technologies: ${j.technologies.join(", ")}.` : "",
    j.jobType ? `${j.jobType}.` : "",
    j.language ? `Working language: ${j.language}.` : "",
    visa === "yes" ? "Visa sponsorship for non-EU residents." : "",
  ].filter(Boolean).join(" ");
  return {
    source: "germantechjobs",
    externalId: String(j._id),
    url: String(j.redirectJobUrl || (j.jobUrl ? `https://germantechjobs.de/jobs/${j.jobUrl}` : "")),
    title: String(j.name),
    company: String(j.company ?? ""),
    location: j.actualCity ? `${j.actualCity}, Germany` : "Germany",
    remote: workMode === "remote",
    workMode,
    salaryText: salary,
    description,
    postedAt: j.activeFrom ? new Date(j.activeFrom) : undefined,
    visa,
  };
}

export const germantechjobs: Source = {
  name: "germantechjobs",
  async fetch(): Promise<RawJob[]> {
    try {
      const res = await fetch(API_URL, {
        headers: { "User-Agent": UA, Accept: "application/json" },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) return [];
      const data = await res.json();
      return (Array.isArray(data) ? data : [])
        .map(mapGermanTechJob)
        .filter((j): j is RawJob => j !== null && j.url !== "");
    } catch {
      return [];
    }
  },
};
