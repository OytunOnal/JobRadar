import { profile } from "../profile";
import { stripHtml, type RawJob, type Source } from "./types";

// Adzuna aggregates many job boards (free developer API, strong EU coverage,
// salary data). Get keys at https://developer.adzuna.com — set ADZUNA_APP_ID
// and ADZUNA_APP_KEY in .env. Skipped silently when keys are missing.
//
// One request per (country, query). Both lists are env-configurable; the
// defaults stay modest to respect the free tier.
const COUNTRIES = (process.env.ADZUNA_COUNTRIES || "gb,de,nl")
  .split(",").map((s) => s.trim()).filter(Boolean);
// Env wins; else the CV-generated profile; else the template default.
const QUERIES = (process.env.ADZUNA_QUERIES ||
  profile.searchQueries?.join(",") ||
  "unity developer,game developer,ai engineer,full stack developer")
  .split(",").map((s) => s.trim()).filter(Boolean);

export const adzuna: Source = {
  name: "adzuna",
  async fetch(): Promise<RawJob[]> {
    const id = process.env.ADZUNA_APP_ID;
    const key = process.env.ADZUNA_APP_KEY;
    if (!id || !key) return [];

    const out: RawJob[] = [];
    const seen = new Set<string>();
    for (const country of COUNTRIES) {
      for (const q of QUERIES) {
        try {
          const url =
            `https://api.adzuna.com/v1/api/jobs/${country}/search/1` +
            `?app_id=${id}&app_key=${key}&results_per_page=50` +
            `&what=${encodeURIComponent(q)}&sort_by=date`;
          const res = await fetch(url, { headers: { Accept: "application/json" } });
          if (!res.ok) continue;
          const data = await res.json();
          for (const j of data.results ?? []) {
            const extId = String(j.id);
            if (seen.has(extId)) continue; // same job can match several queries
            seen.add(extId);
            const text = `${j.title ?? ""} ${j.description ?? ""}`;
            out.push({
              source: "adzuna",
              externalId: extId,
              url: j.redirect_url ?? "",
              title: stripHtml(j.title ?? ""),
              company: j.company?.display_name ?? "",
              location: j.location?.display_name ?? country.toUpperCase(),
              remote: /remote|work from home|home office/i.test(text),
              salaryText:
                j.salary_min != null
                  ? `${Math.round(j.salary_min)}–${Math.round(j.salary_max ?? j.salary_min)}`
                  : undefined,
              description: stripHtml(j.description ?? ""),
              postedAt: j.created ? new Date(j.created) : undefined,
            });
          }
        } catch {
          // one bad (country, query) pair shouldn't sink the source
        }
      }
    }
    return out;
  },
};
