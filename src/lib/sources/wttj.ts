import { profileSearchGroups } from "../profile";
import { stripHtml, type RawJob, type Source } from "./types";

// Welcome to the Jungle — France's biggest tech board (global reach), via its
// public Algolia search index (the same one the site's jobs UI calls). The
// Algolia app id + client key are public but ROTATE, so they are read fresh
// from /api/env each run; the key is referer-locked, so every Algolia request
// sends a welcometothejungle.com Referer. (Contract learned from career-ops'
// wttj provider.)
//
// Queries: EN + FR leads from the profile's search groups. The board is
// enormous, so hits are capped per query and the keyword scorer gates storage.
//
// Config: WTTJ_MAX_HITS (100/query, cap 200)

const SITE = "https://www.welcometothejungle.com";
const INDEX = "wttj_jobs_production_en";
const UA = "JobRadar/0.1 (personal job search)";
const MAX_HITS = Math.min(Number(process.env.WTTJ_MAX_HITS) || 100, 200);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function parseEnvPayload(text: string): { appId: string; apiKey: string } | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  let env: any;
  try {
    env = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  const appId = String(env.PUBLIC_ALGOLIA_APPLICATION_ID ?? "").trim();
  const apiKey = String(env.PUBLIC_ALGOLIA_API_KEY_CLIENT ?? "").trim();
  // The app id becomes a hostname — keep it tightly shaped.
  if (!/^[A-Z0-9]{6,16}$/i.test(appId) || apiKey.length < 16 || apiKey.length > 500) return null;
  return { appId, apiKey };
}

export function mapHit(h: any): RawJob | null {
  const title = String(h?.name ?? "").trim();
  const slug = String(h?.slug ?? "").trim();
  const orgSlug = String(h?.organization?.slug ?? "").trim();
  if (!title || !/^[a-z0-9_-]+$/i.test(slug) || !/^[a-z0-9_-]+$/i.test(orgSlug)) return null;
  const office = Array.isArray(h.offices) && h.offices[0] ? h.offices[0] : {};
  const location = [office.city, office.country].filter(Boolean).join(", ");
  const salary =
    h.salary_yearly_minimum > 0
      ? `${h.salary_yearly_minimum}${h.salary_period === "yearly" && h.salary_maximum > 0 ? `–${h.salary_maximum}` : "+"} ${String(h.salary_currency ?? "").toUpperCase()}`.trim()
      : undefined;
  return {
    source: "wttj",
    externalId: `${orgSlug}/${slug}`,
    url: `${SITE}/en/companies/${orgSlug}/jobs/${slug}`,
    title,
    company: String(h.organization?.name ?? "").trim(),
    location: location || undefined,
    remote: h.remote === "fulltime",
    workMode: h.remote === "fulltime" ? "remote" : h.remote === "partial" ? "hybrid" : undefined,
    salaryText: salary,
    // `profile` is the posting's "profil recherché" — a named REQUIREMENTS
    // section, stored in Algolia as authored, i.e. rich text. Calling it
    // "teaser text" was an assumption; this file imported no converter.
    description: stripHtml(String(h.profile ?? "")),
    postedAt: Number.isFinite(h.published_at_timestamp) && h.published_at_timestamp > 0
      ? new Date(h.published_at_timestamp * 1000)
      : undefined,
  };
}

export async function fetchWttj(fetchImpl: typeof fetch = fetch): Promise<RawJob[]> {
  let creds: { appId: string; apiKey: string } | null = null;
  try {
    const res = await fetchImpl(`${SITE}/api/env`, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) creds = parseEnvPayload(await res.text());
  } catch {
    /* unreachable → skip below */
  }
  if (!creds) return [];

  const queries = new Set<string>();
  for (const g of profileSearchGroups(4)) {
    queries.add(g.en[0]);
    if (g.fr?.[0]) queries.add(g.fr[0]);
  }

  const out: RawJob[] = [];
  const seen = new Set<string>();
  for (const query of queries) {
    try {
      const res = await fetchImpl(
        `https://${creds.appId}-dsn.algolia.net/1/indexes/${INDEX}/query`,
        {
          method: "POST",
          headers: {
            "User-Agent": UA,
            "Content-Type": "application/json",
            Referer: `${SITE}/`,
            "x-algolia-application-id": creds.appId,
            "x-algolia-api-key": creds.apiKey,
          },
          body: JSON.stringify({ query, hitsPerPage: MAX_HITS }),
          signal: AbortSignal.timeout(20_000),
        },
      );
      if (!res.ok) continue;
      const data = await res.json();
      for (const h of data?.hits ?? []) {
        const job = mapHit(h);
        if (!job || seen.has(job.externalId)) continue;
        seen.add(job.externalId);
        out.push(job);
      }
    } catch {
      /* one query down shouldn't sink the source */
    }
    await sleep(400);
  }
  return out;
}

export const wttj: Source = {
  name: "wttj",
  fetch: () => fetchWttj(),
};
