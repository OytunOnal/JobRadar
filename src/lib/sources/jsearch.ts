import { profile } from "../profile";
import { stripHtml, type RawJob, type Source } from "./types";

// JSearch (via RapidAPI) indexes Google for Jobs — which carries LinkedIn,
// Indeed, Glassdoor, and ZipRecruiter listings. Free tier is call-limited, so
// we make one request per query and keep the default query list short.
// Key: https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch — set
// RAPIDAPI_KEY in .env. Skipped silently when the key is missing.
// Env wins; else the CV-generated profile; else the template default.
const QUERIES = (process.env.JSEARCH_QUERIES ||
  profile.searchQueries?.join(",") ||
  "unity developer remote,ai engineer remote europe,full stack developer remote europe")
  .split(",").map((s) => s.trim()).filter(Boolean);

export const jsearch: Source = {
  name: "jsearch",
  async fetch(): Promise<RawJob[]> {
    const key = process.env.RAPIDAPI_KEY;
    if (!key) return [];

    const out: RawJob[] = [];
    const seen = new Set<string>();
    for (const q of QUERIES) {
      try {
        // Note: the current API version serves /search-v2 (the old /search 404s)
        // and nests results under data.jobs.
        const url =
          `https://jsearch.p.rapidapi.com/search-v2?query=${encodeURIComponent(q)}` +
          `&date_posted=week`;
        const res = await fetch(url, {
          headers: {
            "X-RapidAPI-Key": key,
            "X-RapidAPI-Host": "jsearch.p.rapidapi.com",
          },
        });
        if (!res.ok) continue;
        const data = await res.json();
        for (const j of data.data?.jobs ?? []) {
          const extId = String(j.job_id);
          if (seen.has(extId)) continue;
          seen.add(extId);
          const loc = [j.job_city, j.job_country].filter(Boolean).join(", ");
          out.push({
            source: "jsearch",
            externalId: extId,
            url: j.job_apply_link ?? "",
            title: stripHtml(j.job_title ?? ""),
            company: j.employer_name ?? "",
            location: loc || (j.job_is_remote ? "Remote" : ""),
            remote: Boolean(j.job_is_remote),
            salaryText:
              j.job_min_salary != null
                ? `${Math.round(j.job_min_salary)}–${Math.round(j.job_max_salary ?? j.job_min_salary)}`
                : undefined,
            description: stripHtml(j.job_description ?? ""),
            postedAt: j.job_posted_at_datetime_utc ? new Date(j.job_posted_at_datetime_utc) : undefined,
          });
        }
      } catch {
        // skip a failing query
      }
    }
    return out;
  },
};
