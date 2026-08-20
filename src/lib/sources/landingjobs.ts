import { stripHtml, type RawJob, type Source } from "./types";

// Landing.Jobs — Portugal-centric European tech board with a relocation
// focus. Keyless JSON API; the page/sort params are IGNORED server-side
// (verified live: page 2 returns the same 50 ids), so this is one request
// for the API's fixed ~50-job window. Old-but-open postings are filtered by
// ingest's own age guard; the fresh handful is the weekly contribution.
// relocation_paid is the board's own flag → structured visa signal.

const API_URL = "https://landing.jobs/api/v1/jobs?limit=100";
const UA = "JobRadar/0.1 (personal job search)";

export function mapJob(j: any): RawJob | null {
  if (!j?.id || !j?.title || !j?.url) return null;
  // The API carries no company field; the job URL path does: /at/<company>/…
  const companySlug = /\/at\/([^/]+)\//.exec(String(j.url))?.[1] ?? "";
  const company = companySlug.replace(/-/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase());
  const locations = Array.isArray(j.locations)
    ? j.locations.map((l: any) => (typeof l === "string" ? l : [l?.city, l?.country_code?.toUpperCase()].filter(Boolean).join(", "))).filter(Boolean)
    : [];
  const salary =
    j.gross_salary_low != null
      ? `${j.gross_salary_low}–${j.gross_salary_high ?? j.gross_salary_low} ${j.currency_code ?? ""}`.trim()
      : undefined;
  const description = stripHtml(
    [j.role_description, j.main_requirements, j.nice_to_have, j.perks].filter(Boolean).join("\n"),
  );
  return {
    source: "landingjobs",
    externalId: String(j.id),
    url: String(j.url),
    title: String(j.title),
    company,
    location: locations.join("; ") || "Portugal",
    remote: Boolean(j.remote),
    salaryText: salary,
    description,
    postedAt: j.published_at ? new Date(j.published_at) : undefined,
    // The board's own relocation flag; false is "not offered", not a refusal.
    visa: j.relocation_paid === true ? "yes" : undefined,
  };
}

export const landingjobs: Source = {
  name: "landingjobs",
  async fetch(): Promise<RawJob[]> {
    try {
      const res = await fetch(API_URL, {
        headers: { "User-Agent": UA, Accept: "application/json" },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) return [];
      const data = await res.json();
      return (Array.isArray(data) ? data : []).map(mapJob).filter((j): j is RawJob => j !== null);
    } catch {
      return [];
    }
  },
};
