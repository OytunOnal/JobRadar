import { stripHtml, type RawJob, type Source } from "./types";

// The Stack Jobs (jobs.trythestack.co) — a curated European board whose entire
// premise is visa sponsorship, with a per-posting sponsorship flag. Measured:
// 1,963 rows, refreshed daily, real employers (Zalando, Scalable, Anthropic),
// full 1,300-1,800 character descriptions, Germany and the UK leading.
//
// HOW WE READ IT, AND WHY THAT NEEDED A DECISION. The site is a single-page
// app: bot, browser and Googlebot all receive the same 2.7KB shell with no
// JSON-LD and the homepage as canonical, so there is nothing to scrape. Its
// data comes from the public Supabase REST endpoint its own frontend queries
// on every page load, with the anon key its bundle ships — public by design.
//
// Using that endpoint was the user's call, made against a real tension. In
// favour: robots.txt names ClaudeBot and anthropic-ai with `Allow: /`, and the
// site publishes an llms.txt courting AI agents. Against: llms.txt points at
// the sitemap and human pages, never at an API, and "you may crawl our pages"
// is not literally "you may query our database". We hold elsewhere that stated
// intent outranks the letter — it is why Switzerland's Job-Room, with 74,094
// postings behind an open endpoint, is deliberately not ingested: its robots
// opens "# Do not crawl Job Adverts". Here the stated intent points the other
// way, and the described path turns out to carry no data.
//
// The anon key is DISCOVERED, not committed. The adapter does what a browser
// does — reads the homepage, finds the bundle, takes the key from it — so a
// rotated key heals itself and this repository never carries a third party's
// credential. Same discover-then-fetch reasoning as the Portuguese register.
//
// Config: TRYTHESTACK_MAX (default 200 rows per ingest, newest first).

const HOME = "https://jobs.trythestack.co/";
const MAX = Number(process.env.TRYTHESTACK_MAX) || 200;
const UA = "JobRadar/0.1 (personal job search)";

interface Endpoint {
  base: string;
  key: string;
}

/** Read the site's own bundle for the public Supabase project and anon key. */
export async function discoverEndpoint(fetchImpl: typeof fetch = fetch): Promise<Endpoint | null> {
  const html = await (await fetchImpl(HOME, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(25_000) })).text();
  const src = [...html.matchAll(/src="([^"]+\.js)"/g)].map((m) => m[1]!).find((s) => /assets\//.test(s));
  if (!src) return null;
  const url = src.startsWith("http") ? src : new URL(src, HOME).toString();
  const js = await (await fetchImpl(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(45_000) })).text();
  const base = js.match(/https:\/\/[a-z0-9]+\.supabase\.co/)?.[0];
  const key = js.match(/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/)?.[0];
  return base && key ? { base, key } : null;
}

export function mapStackRow(row: any): RawJob | null {
  const title = String(row?.title ?? "").trim();
  const company = String(row?.organization ?? "").trim();
  if (!title || !company) return null;
  // The board exists to list sponsored roles and sets the flag per posting, so
  // this is a SOURCE claim in the same tier as SwissDevJobs' structured field —
  // not the inference-from-a-register that huntukvisa's rating is, which is
  // why that one travels as text and this one as evidence.
  const visa: RawJob["visa"] = String(row?.visa_sponsorship ?? "").toLowerCase() === "true" ? "yes" : undefined;
  const place = [row?.location, row?.country].map((v: unknown) => String(v ?? "").trim()).filter(Boolean).join(", ");
  const posted = row?.date_posted && !Number.isNaN(Date.parse(row.date_posted)) ? new Date(row.date_posted) : undefined;
  return {
    source: "trythestack",
    externalId: String(row?.id ?? row?.job_url ?? title),
    // job_url points at the employer's own application page, which is where a
    // human should land; the board's own page renders nothing without JS.
    url: String(row?.job_url ?? "").trim() || HOME,
    title,
    company,
    location: place,
    remote: row?.remote === true || /remote/i.test(String(row?.remote ?? "")),
    ...(visa ? { visa } : {}),
    salaryText: String(row?.salary ?? "").trim() || undefined,
    description: stripHtml(String(row?.job_description ?? "")) || title,
    postedAt: posted,
  };
}

export const trythestack: Source = {
  name: "trythestack",
  async fetch(): Promise<RawJob[]> {
    const ep = await discoverEndpoint();
    if (!ep) throw new Error("trythestack: could not discover the public endpoint from the site bundle");
    const cols =
      "id,title,organization,job_url,country,location,visa_sponsorship,salary,remote,job_description,date_posted,status";
    const res = await fetch(
      `${ep.base}/rest/v1/jobs?select=${cols}&status=eq.active&order=date_posted.desc&limit=${MAX}`,
      {
        headers: { apikey: ep.key, Authorization: `Bearer ${ep.key}`, "User-Agent": UA },
        signal: AbortSignal.timeout(45_000),
      },
    );
    if (!res.ok) throw new Error(`trythestack -> HTTP ${res.status}`);
    const rows: any[] = await res.json();
    return rows.map(mapStackRow).filter((j): j is RawJob => j !== null);
  },
};
