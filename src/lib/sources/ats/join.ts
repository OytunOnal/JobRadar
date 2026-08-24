import { getText, type RawJob } from "../types";

// JOIN: no public API — the company page embeds __NEXT_DATA__ with
// state.jobs.items. Paged (?page=N); capped to keep the huge pool affordable.

// The embedded state, parsed. Pure over the page HTML, which is the half worth
// testing: a scrape breaks when the page shape moves, and this is that shape.
export function parseJoinState(html: string): any | null {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try {
    return JSON.parse(m[1])?.props?.pageProps?.initialState ?? null;
  } catch {
    return null;
  }
}

export function mapJoinItems(items: any[], token: string, company: string, companySlug: string): RawJob[] {
  const out: RawJob[] = [];
  for (const j of Array.isArray(items) ? items : []) {
    if (!j?.title || !j?.idParam) continue;
    out.push({
      source: `join:${token}`,
      externalId: String(j.idParam),
      url: `https://join.com/companies/${companySlug}/jobs/${j.idParam}`,
      title: String(j.title),
      company,
      location: j.city?.cityName ?? "",
      remote: /remote/i.test(String(j.title)),
      description: String(j.title), // embedded state has no body
      postedAt: undefined,
    });
  }
  return out;
}

export async function join(token: string, company: string): Promise<RawJob[]> {
  const MAX_PAGES = 3;
  const out: RawJob[] = [];
  let companySlug = token;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const html = await getText(`https://join.com/companies/${token}${page > 1 ? `?page=${page}` : ""}`);
    const state = parseJoinState(html);
    if (!state) break;
    companySlug = state?.company?.domain || companySlug;
    out.push(...mapJoinItems(state?.jobs?.items ?? [], token, company, companySlug));
    const pageCount = Number(state?.jobs?.pagination?.pageCount ?? 1);
    if (page >= pageCount) break;
  }
  return out;
}
