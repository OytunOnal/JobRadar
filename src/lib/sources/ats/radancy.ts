import { getJSON, stripHtml, type RawJob } from "../types";

// Radancy (TalentBrew). Token = "<host>/<langPrefix>" (careers.munichre.com/en).
// JSON envelope with an HTML fragment payload. Two live-verified hard rules:
// SearchResultsModuleName must be sent (else silently empty), and
// SearchFiltersModuleName must NOT be (else a multi-MB facet blob attaches).

// The fragment is HTML inside JSON — this walks it. Pure, and the piece most
// likely to break when a tenant restyles its result list.
export function parseRadancyFragment(frag: string, token: string, host: string): RawJob[] {
  const out: RawJob[] = [];
  for (const m of frag.matchAll(/<a[^>]+href="([^"]+\/job\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = m[1];
    const inner = stripHtml(m[2]).trim();
    if (!inner) continue;
    const url = href.startsWith("http") ? href : `https://${host}${href}`;
    const id = href.match(/\/(\d+)\/?$/)?.[1] ?? url;
    out.push({
      source: `radancy:${token}`,
      externalId: String(id),
      url,
      title: inner.split("\n")[0].trim(),
      company: "",
      location: "", // fragment list-level location markup varies per tenant
      remote: /remote/i.test(inner),
      description: inner,
      postedAt: undefined,
    });
  }
  return out;
}

export function radancyTotalPages(frag: string): number {
  return Number(frag.match(/data-total-pages="(\d+)"/)?.[1] ?? 1);
}

export async function radancy(token: string, company: string): Promise<RawJob[]> {
  const [host, ...langParts] = token.split("/");
  const lang = langParts.join("/");
  const base = `https://${host}${lang ? `/${lang}` : ""}`;
  const out: RawJob[] = [];
  for (let page = 1; page <= 40; page++) {
    const res = await getJSON(
      `${base}/search-jobs/results?ActiveFacetID=0&CurrentPage=${page}&RecordsPerPage=100&Distance=50` +
        `&RadiusUnitType=0&Keywords=&Location=&ShowRadius=False&IsPagination=True&CustomFacetName=` +
        `&FacetTerm=&FacetType=0&SearchResultsModuleName=Search+Results&SortCriteria=0&SortDirection=0&SearchType=5`,
    );
    const frag: string = res?.results ?? "";
    for (const j of parseRadancyFragment(frag, token, host)) out.push({ ...j, company });
    if (page >= radancyTotalPages(frag)) break;
  }
  // The anchor regex can catch duplicate links to the same job — dedupe by id.
  return [...new Map(out.map((j) => [j.externalId, j])).values()];
}
