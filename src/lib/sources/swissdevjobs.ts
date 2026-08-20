import { type RawJob, type Source } from "./types";

// SwissDevJobs — Swiss developer board with STRUCTURED visa data: every job
// carries hasVisaSponsorship (Yes/No), a workplace mode, a salary range, and
// usually the employer's own apply link (redirectJobUrl). The documented
// /api/jobsExtended is deprecated (returns an HTML shell); /api/jobsLight is
// the live one — the full board in one request (~190 jobs).
//
// jobsLight has no description BODY; we synthesize one from the structured
// fields (technologies, level, type, language) — plenty for keyword scoring,
// thin-but-honest for the LLM fit pass. Overlap with ch-jobroom is handled
// by the dedup funnel.

const API_URL = "https://swissdevjobs.ch/api/jobsLight";
const UA = "Mozilla/5.0 (compatible; JobRadar/0.1; personal job search)";

const WORK_MODES = new Set(["remote", "hybrid", "onsite"]);

export function mapJob(j: any): RawJob | null {
  if (!j?._id || !j?.name || j?.isPaused) return null;
  const salary =
    j.annualSalaryFrom != null
      ? `${j.annualSalaryFrom}–${j.annualSalaryTo ?? j.annualSalaryFrom} CHF`
      : undefined;
  const workplace = String(j.workplace ?? "").toLowerCase();
  const workMode = WORK_MODES.has(workplace) ? (workplace as RawJob["workMode"]) : undefined;
  const visa =
    j.hasVisaSponsorship === "Yes" ? "yes" : j.hasVisaSponsorship === "No" ? "no" : undefined;
  const description = [
    `${j.expLevel ?? ""} ${j.name} at ${j.company ?? "?"} (${j.actualCity ?? "Switzerland"}).`,
    Array.isArray(j.technologies) && j.technologies.length ? `Technologies: ${j.technologies.join(", ")}.` : "",
    j.jobType ? `${j.jobType}.` : "",
    j.language ? `Working language: ${j.language}.` : "",
    visa === "yes" ? "Visa sponsorship for non-EU residents." : "",
  ].filter(Boolean).join(" ");
  return {
    source: "swissdevjobs",
    externalId: String(j._id),
    url: String(j.redirectJobUrl || (j.jobUrl ? `https://swissdevjobs.ch/jobs/${j.jobUrl}` : "")),
    title: String(j.name),
    company: String(j.company ?? ""),
    location: j.actualCity ? `${j.actualCity}, Switzerland` : "Switzerland",
    remote: workMode === "remote",
    workMode,
    salaryText: salary,
    description,
    postedAt: j.activeFrom ? new Date(j.activeFrom) : undefined,
    visa,
  };
}

export const swissdevjobs: Source = {
  name: "swissdevjobs",
  async fetch(): Promise<RawJob[]> {
    try {
      const res = await fetch(API_URL, {
        headers: { "User-Agent": UA, Accept: "application/json" },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) return [];
      const data = await res.json();
      return (Array.isArray(data) ? data : [])
        .map(mapJob)
        .filter((j): j is RawJob => j !== null && j.url !== "");
    } catch {
      return [];
    }
  },
};
