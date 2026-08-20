import { COUNTRY_LANGUAGE, COUNTRY_NAMES, REGIONS } from "../geo";
import { profileSearchGroups, type SearchGroup } from "../profile";
import { stripHtml, type RawJob, type Source } from "./types";

// EURES — the EU's official job-mobility portal (europa.eu/eures). Every
// member state's public employment service feeds it: werk.nl (NL), SEPE (ES),
// IEFP (PT), France Travail (FR)… none of which expose a public vacancy API of
// their own. One keyless POST endpoint covers them all.
//
// Contract quirks (verified live 2026-08):
//   - keywords[] entries are ANDed; a multi-word phrase in ONE entry matches
//     nothing — each word must be its own {keyword, specificSearchCode} entry.
//   - specificSearchCode: TITLE restricts to the job title (EVERYWHERE is far
//     too loose: "software engineer" EVERYWHERE ≈ every posting mentioning
//     either word anywhere).
//   - search results already carry the full (HTML) description — no per-job
//     detail calls needed.
//
// Default sweep: every EURES member (EU + no/is/ch) — the profile's
// acceptRegions already accepts Europe-wide onsite roles, and per-country
// searches are the only way to beat the 50-most-recent page cap. German
// postings overlap the native Arbeitsagentur source; the dedup funnel keeps
// the richer BA copy.
//
// Config: EURES_COUNTRIES (";"-sep ISO codes to narrow the sweep)
//         EURES_LIMIT (50/search)

const SEARCH_URL = "https://europa.eu/eures/api/jv-searchengine/public/jv-search/search";
const UA = "JobRadar/0.1 (personal job search)";
const LIMIT = Number(process.env.EURES_LIMIT) || 50;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// EU members + the non-EU EURES members (Norway, Iceland, Switzerland).
export function defaultCountries(): string[] {
  return [...new Set([...REGIONS.eu, "no", "is", "ch"])];
}

function countries(): string[] {
  const env = process.env.EURES_COUNTRIES;
  if (env) return env.split(";").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return defaultCountries();
}

export function buildPayload(title: string, country: string): object {
  return {
    resultsPerPage: LIMIT,
    page: 1,
    sortSearch: "MOST_RECENT",
    // AND of single words — a multi-word phrase in one entry matches nothing.
    keywords: title.split(/\s+/).filter(Boolean).map((keyword) => ({
      keyword,
      specificSearchCode: "TITLE",
    })),
    publicationPeriod: "LAST_WEEK",
    locationCodes: [country],
    requestLanguage: "en",
  };
}

// Which titles to run in which country: EN lead everywhere; the local-language
// lead where we have one (the national services carry local-titled postings).
export function titlesFor(group: SearchGroup, country: string): string[] {
  const lang = COUNTRY_LANGUAGE[country];
  const titles = [group.en[0]];
  const local = lang ? group[lang]?.[0] : undefined;
  if (local) titles.push(local);
  return [...new Set(titles)];
}

// A search-result jv → RawJob. The id is base64ish and doubles as the public
// detail-page URL slug.
export function mapJv(jv: any, country: string): RawJob | null {
  if (!jv?.id || !jv?.title) return null;
  const employer = jv.employer?.name ? String(jv.employer.name) : "";
  const countryName = COUNTRY_NAMES[country] ?? country.toUpperCase();
  const posted = jv.creationDate ?? jv.lastModificationDate;
  return {
    source: "eures",
    externalId: String(jv.id),
    url: `https://europa.eu/eures/portal/jv-se/jv-details/${encodeURIComponent(String(jv.id))}?lang=en`,
    title: stripHtml(String(jv.title)),
    company: employer,
    location: countryName,
    remote: false, // no work-mode facet in results; deriveWorkMode reads the text
    description: stripHtml(String(jv.description ?? "")),
    postedAt: typeof posted === "number" ? new Date(posted) : undefined,
  };
}

async function euresSearch(payload: object, fetchImpl: typeof fetch): Promise<any | null> {
  try {
    const res = await fetchImpl(SEARCH_URL, {
      method: "POST",
      headers: { "User-Agent": UA, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function fetchEures(fetchImpl: typeof fetch = fetch): Promise<RawJob[]> {
  const out: RawJob[] = [];
  const seen = new Set<string>();
  const groups = profileSearchGroups(4);
  for (const country of countries()) {
    const titles = new Set(groups.flatMap((g) => titlesFor(g, country)));
    for (const title of titles) {
      const data = await euresSearch(buildPayload(title, country), fetchImpl);
      for (const jv of data?.jvs ?? []) {
        const job = mapJv(jv, country);
        if (!job || seen.has(job.externalId)) continue;
        seen.add(job.externalId);
        out.push(job);
      }
      await sleep(500);
    }
  }
  return out;
}

export const eures: Source = {
  name: "eures",
  fetch: () => fetchEures(),
};
