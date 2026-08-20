import { stripHtml, type RawJob, type Source } from "./types";

// Hacker News "Ask HN: Who is hiring?" — the monthly hiring thread, via the
// free Algolia API. Each TOP-LEVEL comment is one company's posting, usually
// headed "Company | Role(s) | Location | ..." with the body as free text.
// Comments very often link straight to a greenhouse/lever/ashby posting, so
// when a comment carries a link we use it as the job URL — which also feeds
// the discovery harvest a first-party ATS URL. Fallback: the HN permalink.
//
// The author_whoishiring tag guards against lookalike threads. We take the
// current thread plus last month's if it is still within the freshness
// window (a new thread starts nearly empty on the 1st).
//
// Config: HN_MAX_THREADS (2)

const SEARCH_URL = "https://hn.algolia.com/api/v1/search_by_date";
const ITEM_URL = "https://hn.algolia.com/api/v1/items";
const UA = "JobRadar/0.1 (personal job search)";
const MAX_THREADS = Number(process.env.HN_MAX_THREADS) || 2;
const MAX_AGE_MS = 45 * 86_400_000; // matches ingest's tooOldToStore horizon

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function decodeEntities(s: string): string {
  return s
    .replace(/&#x2F;/gi, "/")
    .replace(/&#x27;/gi, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}

// First non-mailto link in the comment HTML — usually the apply/ATS URL.
export function firstLink(html: string): string | null {
  for (const m of html.matchAll(/<a href="([^"]+)"/gi)) {
    const url = decodeEntities(m[1]);
    if (/^https?:\/\//.test(url) && !/^https?:\/\/(news\.ycombinator|hn\.algolia)/.test(url)) {
      return url;
    }
  }
  return null;
}

// "Company | Role | Location | …" header → RawJob pieces. The title keeps
// every non-company segment: keyword scoring matches substrings, and HN
// headers put roles and locations in no fixed order.
export function parseComment(c: any): RawJob | null {
  const html: string = c?.text ?? "";
  if (!c?.id || html.length < 60) return null; // deleted/empty/too thin
  const text = stripHtml(decodeEntities(html));
  const header = text.split(/\n/)[0] ?? text.slice(0, 200);
  const segments = header.split("|").map((s) => s.trim()).filter(Boolean);
  if (segments.length === 0) return null;
  const company = segments[0].slice(0, 80);
  const title = (segments.length > 1 ? segments.slice(1).join(" | ") : header).slice(0, 200);
  return {
    source: "hn-whoishiring",
    externalId: String(c.id),
    url: firstLink(html) ?? `https://news.ycombinator.com/item?id=${c.id}`,
    title,
    company,
    remote: /\bremote\b/i.test(header),
    description: text.slice(0, 8000),
    postedAt: c.created_at ? new Date(c.created_at) : undefined,
  };
}

async function getJson(url: string, fetchImpl: typeof fetch): Promise<any | null> {
  try {
    const res = await fetchImpl(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function fetchHn(fetchImpl: typeof fetch = fetch): Promise<RawJob[]> {
  const found = await getJson(
    `${SEARCH_URL}?query=${encodeURIComponent('"Ask HN: Who is hiring?"')}` +
      `&tags=story,author_whoishiring&hitsPerPage=${MAX_THREADS}`,
    fetchImpl,
  );
  const out: RawJob[] = [];
  for (const hit of found?.hits ?? []) {
    if (!/who is hiring/i.test(hit?.title ?? "")) continue;
    if (Date.now() - new Date(hit.created_at).getTime() > MAX_AGE_MS) continue;
    const tree = await getJson(`${ITEM_URL}/${hit.objectID}`, fetchImpl);
    for (const c of tree?.children ?? []) {
      const job = parseComment(c);
      if (job) out.push(job);
    }
    await sleep(500);
  }
  return out;
}

export const hn: Source = {
  name: "hn-whoishiring",
  fetch: () => fetchHn(),
};
