import { getJSON, getText, postJSON, stripHtml, type RawJob } from "./types";
import { labelledSections } from "../sections";

// Generic connectors for the major applicant-tracking systems. Each takes a
// company's board token and returns that company's postings, normalized.
// These are the highest-signal sources: you choose exactly which companies to
// watch (see companies.ts) instead of filtering a firehose.

export async function greenhouse(token: string, company: string): Promise<RawJob[]> {
  const data = await getJSON(
    `https://boards-api.greenhouse.io/v1/boards/${token}/jobs?content=true`,
  );
  return (data.jobs ?? []).map((j: any) => ({
    source: `gh:${token}`,
    externalId: String(j.id),
    url: j.absolute_url,
    title: j.title ?? "",
    company,
    location: j.location?.name ?? "",
    remote: /remote/i.test(j.location?.name ?? ""),
    description: stripHtml(j.content),
    postedAt: j.updated_at ? new Date(j.updated_at) : undefined,
  }));
}

export async function lever(token: string, company: string, region = ""): Promise<RawJob[]> {
  // Lever's EU instance is a separate deployment with a SEPARATE slug
  // namespace — an EU board 404s on the US API. Pass region "eu" for boards
  // that live at jobs.eu.lever.co.
  const apiHost = region === "eu" ? "api.eu.lever.co" : "api.lever.co";
  const data = await getJSON(`https://${apiHost}/v0/postings/${token}?mode=json`);
  return (Array.isArray(data) ? data : []).map((j: any) => ({
    source: `lever:${token}`,
    externalId: String(j.id),
    url: j.hostedUrl,
    title: j.text ?? "",
    company,
    location: j.categories?.location ?? "",
    remote: /remote/i.test(j.categories?.location ?? "") || /remote/i.test(j.workplaceType ?? ""),
    workMode: j.workplaceType === "remote" ? "remote" as const
      : j.workplaceType === "hybrid" ? "hybrid" as const
      : j.workplaceType === "onsite" ? "onsite" as const : undefined,
    sections: leverSections(j),
    // The fallback when every named block is empty. Structure-destroyed, but
    // better than nothing.
    description: String(j.descriptionPlain ?? ""),
    postedAt: j.createdAt ? new Date(j.createdAt) : undefined,
  }));
}

// Lever does not ship one description — it ships an intro, an ARRAY of titled
// lists, and a closing block. We used to take `descriptionPlain` alone, which
// is the intro only, flattened. Verified against the live API: the `lists`
// entries are titled "Responsibilities" and "Requirements" and hold the
// bullets. So every Lever posting reached the fit judge as a paragraph of
// marketing prose with the actual job requirements discarded at ingest.
//
// Rebuild the document instead, keeping Lever's own headings — they are
// better section labels than anything we could infer.
// Lever names each of its `lists` blocks — those names ARE headings. The
// assembly is ingest's; this only reports what the source gave us.
export function leverSections(j: any): Array<[string, unknown]> {
  const parts: Array<[string, unknown]> = [["", j.description]];
  for (const list of Array.isArray(j.lists) ? j.lists : []) {
    parts.push([String(list?.text ?? "").trim(), list?.content]);
  }
  parts.push(["", j.additional]);
  return parts;
}

export async function ashby(token: string, company: string): Promise<RawJob[]> {
  const data = await getJSON(`https://api.ashbyhq.com/posting-api/job-board/${token}`);
  return (data.jobs ?? []).map((j: any) => ({
    source: `ashby:${token}`,
    externalId: String(j.id ?? j.jobUrl),
    url: j.jobUrl ?? j.applyUrl ?? "",
    title: j.title ?? "",
    company,
    location: j.location ?? j.locationName ?? "",
    remote: Boolean(j.isRemote) || /remote/i.test(j.location ?? ""),
    // HTML first: `descriptionPlain` is the same text with its headings and
    // bullets flattened away, and the section parser needs that structure.
    description: stripHtml(j.descriptionHtml ?? j.description) || String(j.descriptionPlain ?? ""),
    postedAt: j.publishedAt ? new Date(j.publishedAt) : undefined,
  }));
}

export async function smartrecruiters(token: string, company: string): Promise<RawJob[]> {
  const data = await getJSON(
    `https://api.smartrecruiters.com/v1/companies/${token}/postings?limit=100`,
  );
  return (data.content ?? []).map((j: any) => {
    const loc = j.location
      ? [j.location.city, j.location.country].filter(Boolean).join(", ")
      : "";
    return {
      source: `sr:${token}`,
      externalId: String(j.id),
      url: `https://jobs.smartrecruiters.com/${token}/${j.id}`,
      title: j.name ?? "",
      company,
      location: loc,
      remote: Boolean(j.location?.remote),
      // Postings list has no body; title-based scoring still classifies these.
      description: j.name ?? "",
      postedAt: j.releasedDate ? new Date(j.releasedDate) : undefined,
    };
  });
}

export async function workable(token: string, company: string): Promise<RawJob[]> {
  // Widget API: single unauthenticated GET, case-sensitive lowercase slug.
  const data = await getJSON(
    `https://apply.workable.com/api/v1/widget/accounts/${token}`,
  );
  return (data.jobs ?? []).map((j: any) => ({
    source: `workable:${token}`,
    externalId: String(j.shortcode ?? j.code ?? j.url),
    url: j.url ?? j.application_url ?? "",
    title: j.title ?? "",
    company: data.name || company,
    location: [j.city, j.country].filter(Boolean).join(", "),
    remote: Boolean(j.telecommuting),
    // The widget listing has no body text; title-based scoring classifies
    // these (same trade-off as SmartRecruiters).
    description: j.title ?? "",
    postedAt: j.published_on ? new Date(j.published_on) : undefined,
  }));
}

export async function recruitee(token: string, company: string): Promise<RawJob[]> {
  // Public offers API on the company's subdomain; unknown subdomains 404.
  const data = await getJSON(`https://${token}.recruitee.com/api/offers/`);
  return (data.offers ?? []).map((o: any) => ({
    source: `recruitee:${token}`,
    externalId: String(o.id ?? o.guid),
    url: o.careers_url ?? "",
    title: o.title ?? "",
    company: o.company_name || company,
    location: [o.city, o.country].filter(Boolean).join(", "),
    remote: Boolean(o.remote),
    workMode: o.remote ? "remote" as const : o.hybrid ? "hybrid" as const : undefined,
    description: stripHtml(o.description ?? "") || (o.title ?? ""),
    postedAt: o.published_at
      ? new Date(o.published_at)
      : o.created_at
        ? new Date(o.created_at)
        : undefined,
  }));
}

export async function personio(token: string, company: string): Promise<RawJob[]> {
  // XML feed on the company's subdomain. The .de/.com namespaces are mirrored
  // (verified live: the same slug answers on both) — .com is used as canonical.
  // Unknown subdomains 307-redirect to marketing, hence redirect: "manual".
  const xml = await getText(`https://${token}.jobs.personio.com/xml`, {
    redirect: "manual",
  });
  const jobs: RawJob[] = [];
  for (const [, block] of xml.matchAll(/<position>([\s\S]*?)<\/position>/g)) {
    // Position-level tags precede the <jobDescriptions> block in the feed,
    // so a first-match read of <name> is the job title, not a section header.
    const tag = (name: string) => {
      const m = block.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
      return m ? m[1].trim() : "";
    };
    const id = tag("id");
    if (!id) continue;
    const office = stripHtml(tag("office"));
    // Personio ships <jobDescription> PAIRS: a <name> that is the section
    // heading ("Deine Skills", "Deine Benefits") and a <value> holding its
    // HTML. We used to take the values, join them with a SPACE, and discard
    // every heading — turning a structured posting into one flat line.
    const sections: Array<[string, unknown]> = [];
    for (const [, entry] of block.matchAll(/<jobDescription>([\s\S]*?)<\/jobDescription>/g)) {
      const heading = entry.match(/<name>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/name>/)?.[1]?.trim() ?? "";
      const value = entry.match(/<value>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/value>/)?.[1] ?? "";
      if (value.trim()) sections.push([heading, value]);
    }
    // Older feeds carry bare <value> blocks with no pairing — fall back to
    // those rather than returning an empty body. The paired case now travels
    // as sections and is assembled at ingest.
    const description = stripHtml(
      [...block.matchAll(/<value>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/value>/g)]
        .map((m) => m[1]).join("\n\n"),
    );
    const title = stripHtml(tag("name"));
    jobs.push({
      source: `personio:${token}`,
      externalId: id,
      url: `https://${token}.jobs.personio.com/job/${id}`,
      title,
      company: stripHtml(tag("subcompany")) || company,
      location: office,
      remote: /remote|home\s*office/i.test(`${office} ${tag("schedule")} ${title}`),
      sections,
      description: description || title,
      postedAt: tag("createdAt") ? new Date(tag("createdAt")) : undefined,
    });
  }
  return jobs;
}

// Workday's job list gives only a relative "Posted X" string; turn it into an
// approximate date. "30+ Days Ago" is unbounded — treat as unknown rather
// than invent a date.
function workdayPostedAt(postedOn: string | undefined): Date | undefined {
  if (!postedOn) return undefined;
  const s = postedOn.toLowerCase();
  let days: number | undefined;
  if (s.includes("today")) days = 0;
  else if (s.includes("yesterday")) days = 1;
  else {
    const m = s.match(/(\d+)\+?\s*days?/);
    if (m) days = s.includes("+") ? undefined : Number(m[1]);
  }
  if (days === undefined) return undefined;
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d;
}

export async function workday(token: string, company: string): Promise<RawJob[]> {
  // Token is the canonical "tenant@wdN/site" triple (see discovery/platforms).
  const m = token.match(/^([^@]+)@(wd\d+)\/(.+)$/);
  if (!m) throw new Error(`workday: malformed token "${token}"`);
  const [, tenant, wd, site] = m;
  const base = `https://${tenant}.${wd}.myworkdayjobs.com`;
  const out: RawJob[] = [];
  const limit = 20;
  // Enterprise boards list thousands of postings; cap per ingest — keyword
  // scoring drops most of them anyway and the next run refreshes the window.
  const cap = 200;
  for (let offset = 0; offset < cap; offset += limit) {
    const data = await postJSON(`${base}/wday/cxs/${tenant}/${site}/jobs`, {
      limit,
      offset,
      searchText: "",
      appliedFacets: {},
    });
    const posts = data.jobPostings ?? [];
    for (const p of posts) {
      out.push({
        source: `workday:${token}`,
        externalId: String(p.bulletFields?.[0] ?? p.externalPath ?? ""),
        url: `${base}/${site}${p.externalPath ?? ""}`,
        title: p.title ?? "",
        company,
        location: p.locationsText ?? "",
        remote: /remote/i.test(`${p.locationsText ?? ""} ${p.title ?? ""}`),
        // List payload has no body; title-based scoring classifies these.
        description: p.title ?? "",
        postedAt: workdayPostedAt(p.postedOn),
      });
    }
    if (posts.length < limit || offset + limit >= (data.total ?? 0)) break;
  }
  return out;
}

// Teamtailor: public per-tenant RSS at <slug>.teamtailor.com/jobs.rss.
// (Most customers CNAME a branded domain — the registry only sees the
// *.teamtailor.com minority; job links may point at the branded host.)
export async function teamtailor(token: string, company: string): Promise<RawJob[]> {
  const xml = await getText(`https://${token}.teamtailor.com/jobs.rss`);
  const out: RawJob[] = [];
  const pick = (block: string, tag: string) => {
    const m = block.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
    if (!m) return "";
    return m[1].replace(/^\s*<!\[CDATA\[/, "").replace(/\]\]>\s*$/, "").trim();
  };
  for (const block of xml.split(/<item>/).slice(1)) {
    const body = block.split(/<\/item>/)[0];
    const link = pick(body, "link");
    const title = stripHtml(pick(body, "title"));
    if (!link || !title) continue;
    const pub = pick(body, "pubDate");
    out.push({
      source: `teamtailor:${token}`,
      externalId: link.split("/").filter(Boolean).pop() ?? link,
      url: link,
      title,
      company,
      location: stripHtml(pick(body, "tt:location") || pick(body, "location") || pick(body, "tt:city")),
      remote: /remote/i.test(title),
      description: stripHtml(pick(body, "description")),
      postedAt: pub ? new Date(pub) : undefined,
    });
  }
  return out;
}

// BambooHR: /careers/list JSON — lightweight metadata (no body, no dates).
// Shape: { result: [{ id, jobOpeningName, location: {city, state}, isRemote }] }
export async function bamboohr(token: string, company: string): Promise<RawJob[]> {
  const data = await getJSON(`https://${token}.bamboohr.com/careers/list`);
  const rows: any[] = Array.isArray(data?.result) ? data.result : [];
  return rows
    .filter((j) => j?.jobOpeningName && String(j.id ?? "").trim())
    .map((j) => {
      const loc = [j.location?.city, j.location?.state].filter(Boolean).join(", ");
      return {
        source: `bamboohr:${token}`,
        externalId: String(j.id),
        url: `https://${token}.bamboohr.com/careers/${encodeURIComponent(String(j.id))}`,
        title: String(j.jobOpeningName),
        company,
        location: loc,
        remote: Boolean(j.isRemote),
        // List payload has no body; title-based scoring classifies these.
        description: String(j.jobOpeningName),
        postedAt: undefined,
      };
    });
}

// Breezy: <tenant>.breezy.hr/json — top-level array with absolute posting
// URLs and a published date, no body.
export async function breezy(token: string, company: string): Promise<RawJob[]> {
  const data = await getJSON(`https://${token}.breezy.hr/json`);
  const rows: any[] = Array.isArray(data) ? data : [];
  const out: RawJob[] = [];
  for (const j of rows) {
    if (!j?.name || typeof j.url !== "string" || !j.url.startsWith("https://")) continue;
    const loc = j.location ?? {};
    const base = (typeof loc.name === "string" && loc.name.trim()) ||
      [loc.city, loc.state, loc.country?.name].filter(Boolean).join(", ");
    out.push({
      source: `breezy:${token}`,
      externalId: j.url.split("/").filter(Boolean).pop() ?? j.url,
      url: j.url,
      title: String(j.name),
      company,
      location: base,
      remote: Boolean(loc.is_remote),
      description: String(j.name), // no body in the list payload
      postedAt: j.published_date && !Number.isNaN(Date.parse(j.published_date))
        ? new Date(j.published_date)
        : undefined,
    });
  }
  return out;
}

// JOIN: no public API — the company page embeds __NEXT_DATA__ with
// state.jobs.items. Paged (?page=N); capped to keep the huge pool affordable.
export async function join(token: string, company: string): Promise<RawJob[]> {
  const MAX_PAGES = 3;
  const out: RawJob[] = [];
  let companySlug = token;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const html = await getText(`https://join.com/companies/${token}${page > 1 ? `?page=${page}` : ""}`);
    const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!m) break;
    let state: any;
    try {
      state = JSON.parse(m[1])?.props?.pageProps?.initialState;
    } catch {
      break;
    }
    const items: any[] = state?.jobs?.items ?? [];
    companySlug = state?.company?.domain || companySlug;
    for (const j of items) {
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
    const pageCount = Number(state?.jobs?.pagination?.pageCount ?? 1);
    if (page >= pageCount) break;
  }
  return out;
}

// Pinpoint: /postings.json — rich payload (description AND compensation).
export async function pinpoint(token: string, company: string): Promise<RawJob[]> {
  const data = await getJSON(`https://${token}.pinpointhq.com/postings.json`);
  const rows: any[] = Array.isArray(data?.data) ? data.data : [];
  const out: RawJob[] = [];
  for (const j of rows) {
    const url = typeof j?.url === "string" && j.url.startsWith("https://") ? j.url : "";
    if (!j?.title || !url) continue;
    const loc = j.location ?? {};
    out.push({
      source: `pinpoint:${token}`,
      externalId: String(j.id ?? url),
      url,
      title: String(j.title).trim(),
      company,
      location: (typeof loc.name === "string" && loc.name.trim()) ||
        [loc.city, loc.province].filter(Boolean).join(", "),
      remote: /remote/i.test(`${j.workplace_type ?? ""} ${loc.name ?? ""}`),
      salaryText: j.compensation ? String(j.compensation) : undefined,
      description: stripHtml(j.description ?? "") || String(j.title),
      postedAt: undefined,
    });
  }
  return out;
}

// Oracle Cloud Recruiting (ORC). Token is structured like Workday's:
// "<hostPrefix>@<siteNumber>" — e.g. "eeho.fa.us2@CX_45001" for
// eeho.fa.us2.oraclecloud.com. The CE REST API is public JSON, paginated via
// limit/offset INSIDE the finder string. Live-verified quirk: an unknown
// siteNumber does NOT error — the API silently falls back to the default
// site — so liveness means "requisitionList is non-empty", never status 200.
export async function oracle(token: string, company: string): Promise<RawJob[]> {
  const m = token.match(/^([a-z0-9.-]+)@(.+)$/i);
  if (!m) return [];
  const host = `${m[1]}.oraclecloud.com`;
  const site = m[2];
  const out: RawJob[] = [];
  const LIMIT = 200;
  for (let offset = 0; offset < 3000; offset += LIMIT) {
    const url =
      `https://${host}/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true` +
      `&expand=requisitionList.secondaryLocations` +
      `&finder=findReqs;siteNumber=${encodeURIComponent(site)},limit=${LIMIT},offset=${offset},sortBy=POSTING_DATES_DESC`;
    const data = await getJSON(url);
    const item = data?.items?.[0];
    const reqs: any[] = Array.isArray(item?.requisitionList) ? item.requisitionList : [];
    for (const j of reqs) {
      if (!j?.Id || !j?.Title) continue;
      const secondary = (j.secondaryLocations ?? [])
        .map((s: any) => s?.Name)
        .filter(Boolean)
        .join("; ");
      out.push({
        source: `oracle:${token}`,
        externalId: String(j.Id),
        url: `https://${host}/hcmUI/CandidateExperience/en/sites/${site}/job/${j.Id}`,
        title: String(j.Title).trim(),
        company,
        location: [j.PrimaryLocation, secondary].filter(Boolean).join("; "),
        remote: /remote/i.test(`${j.WorkplaceType ?? ""} ${j.PrimaryLocation ?? ""}`),
        // ShortDescriptionStr is a real summary (not a title echo); the full
        // body lives behind the details endpoint (desc-fill territory).
        sections: [
          ["", j.ShortDescriptionStr],
          ["Responsibilities", j.ExternalResponsibilitiesStr],
          ["Requirements", j.ExternalQualificationsStr],
        ],
        description: String(j.Title),
        postedAt: j.PostedDate ? new Date(j.PostedDate) : undefined,
      });
    }
    const total = Number(item?.TotalJobsCount ?? 0);
    if (offset + LIMIT >= total || reqs.length === 0) break;
  }
  return out;
}

// BeeSite (milch & zucker) — German enterprise boards (Mercedes-Benz).
// Token = backend subdomain of app.beesite.de; job URLs point at the branded
// career site. Live-verified 2026-08-21: 2,951 postings on Mercedes.
export async function beesite(token: string, company: string): Promise<RawJob[]> {
  const out: RawJob[] = [];
  const COUNT = 200;
  for (let first = 1; first <= 6000; first += COUNT) {
    const data = {
      LanguageCode: "EN",
      SearchParameters: {
        FirstItem: first,
        CountItem: COUNT,
        Sort: [{ Criterion: "PublicationStartDate", Direction: "DESC" }],
        MatchedObjectDescriptor: [
          "PositionID", "PositionTitle", "PositionURI",
          "PositionLocation.CityName", "PositionLocation.CountryName",
          "PublicationStartDate",
        ],
      },
      SearchCriteria: [],
    };
    const res = await getJSON(
      `https://${token}.app.beesite.de/search?data=${encodeURIComponent(JSON.stringify(data))}`,
    );
    const items: any[] = res?.SearchResult?.SearchResultItems ?? [];
    for (const it of items) {
      const d = it?.MatchedObjectDescriptor;
      if (!d?.PositionID || !d?.PositionTitle) continue;
      const locs = (Array.isArray(d.PositionLocation) ? d.PositionLocation : [d.PositionLocation])
        .filter(Boolean)
        .map((l: any) => [l.CityName, l.CountryName].filter(Boolean).join(", "))
        .filter(Boolean)
        .join("; ");
      out.push({
        source: `beesite:${token}`,
        externalId: String(d.PositionID),
        url: String(d.PositionURI ?? ""),
        title: String(d.PositionTitle).trim(),
        company,
        location: locs,
        remote: /remote|home\s*office/i.test(`${d.PositionTitle} ${locs}`),
        description: String(d.PositionTitle), // list carries no body
        postedAt: d.PublicationStartDate ? new Date(d.PublicationStartDate) : undefined,
      });
    }
    const total = Number(res?.SearchResult?.SearchResultCountAll ?? 0);
    if (first + COUNT > total || items.length === 0) break;
  }
  return out;
}

// SAP SuccessFactors, Career Site Builder generation. Token = the branded
// career-site HOST (jobs.man.eu). Results are LOCALE-GATED (live-verified:
// MAN de_DE=601 vs en_US=8) — the site's /search/ page advertises its locales;
// query each and dedup by id, English first so English titles win.
export async function successfactors(token: string, company: string): Promise<RawJob[]> {
  const origin = `https://${token}`;
  let locales: string[] = [];
  try {
    const html = await getText(`${origin}/search/`);
    locales = [...new Set([...html.matchAll(/locale=([a-z]{2}_[A-Z]{2})/g)].map((m) => m[1]))];
  } catch {
    /* fall through to defaults */
  }
  if (locales.length === 0) locales = ["en_US", "de_DE"];
  locales.sort((a, b) => Number(b.startsWith("en")) - Number(a.startsWith("en")));

  const seen = new Set<string>();
  const out: RawJob[] = [];
  for (const locale of locales) {
    for (let page = 0; page < 100; page++) {
      const res = await postJSON(`${origin}/services/recruiting/v1/jobs`, {
        keywords: "", locale, location: "", pageNumber: page, sortBy: "recent",
      });
      const rows: any[] = res?.jobSearchResult ?? [];
      for (const row of rows) {
        const j = row?.response ?? row;
        if (!j?.id || seen.has(String(j.id))) continue;
        seen.add(String(j.id));
        const loc = (j.jobLocationShort ?? []).filter(Boolean).join("; ");
        out.push({
          source: `sf:${token}`,
          externalId: String(j.id),
          url: `${origin}/job/${j.unifiedUrlTitle ?? j.id}/${j.id}-${locale}`,
          title: String(j.unifiedStandardTitle ?? "").trim(),
          company,
          location: loc,
          remote: /remote|home\s*office/i.test(`${j.unifiedStandardTitle} ${loc}`),
          description: String(j.unifiedStandardTitle ?? ""), // list carries no body
          postedAt: j.unifiedStandardStart ? new Date(j.unifiedStandardStart) : undefined,
        });
      }
      const total = Number(res?.totalJobs ?? 0);
      if (rows.length === 0 || (page + 1) * 10 >= total) break;
    }
  }
  return out;
}

// Eightfold.ai. Token = tenant subdomain (bayer). Server caps pages at 10
// rows regardless of num (live-verified), so big boards cost count/10 calls —
// capped here. 403 "Not authorized for PCSX" = tenant hasn't enabled the
// public career-site API (not bot detection); such boards are unservable.
export async function eightfold(token: string, company: string): Promise<RawJob[]> {
  const out: RawJob[] = [];
  for (let start = 0; start < 1500; start += 10) {
    const data = await getJSON(
      `https://${token}.eightfold.ai/api/apply/v2/jobs?start=${start}&num=10`,
    );
    const rows: any[] = data?.positions ?? [];
    for (const j of rows) {
      if (!j?.id || !j?.name) continue;
      const locs = [j.location, ...(j.locations ?? [])].filter(Boolean);
      out.push({
        source: `eightfold:${token}`,
        externalId: String(j.id),
        url: String(j.canonicalPositionUrl ?? `https://${token}.eightfold.ai/careers/job/${j.id}`),
        title: String(j.name).trim(),
        company,
        location: [...new Set(locs)].slice(0, 4).join("; "),
        remote: locs.some((l: string) => /remote/i.test(l)),
        description: stripHtml(String(j.job_description ?? "")) || String(j.name),
        postedAt: j.t_create ? new Date(Number(j.t_create) * 1000) : undefined, // unix SECONDS
      });
    }
    const total = Number(data?.count ?? 0);
    if (rows.length === 0 || start + 10 >= total) break;
  }
  return out;
}

// JibeApply (iCIMS' career-site layer). Token = subdomain (nfiindustries).
// Clean public JSON with FULL descriptions — also the practical route into
// iCIMS tenants, whose own portals sit behind an AWS WAF.
export async function jibe(token: string, company: string): Promise<RawJob[]> {
  const out: RawJob[] = [];
  for (let page = 1; page <= 150; page++) {
    const data = await getJSON(`https://${token}.jibeapply.com/api/jobs?page=${page}`);
    const rows: any[] = data?.jobs ?? [];
    for (const row of rows) {
      const j = row?.data ?? row;
      if (!j?.title) continue;
      out.push({
        source: `jibe:${token}`,
        externalId: String(j.req_id ?? j.slug ?? ""),
        url: String(j.apply_url ?? `https://${token}.jibeapply.com/jobs/${j.slug ?? ""}`),
        title: String(j.title).trim(),
        company,
        location: String(j.full_location ?? j.location_name ?? ""),
        remote: /remote/i.test(`${j.title} ${j.full_location ?? ""}`),
        description: stripHtml(String(j.description ?? "")) || String(j.title),
        postedAt: j.posted_date ? new Date(j.posted_date) : undefined,
      });
    }
    const total = Number(data?.totalCount ?? 0);
    if (rows.length === 0 || page * 10 >= total) break;
  }
  return out;
}

// Rippling ATS. Token = board slug. One row PER LOCATION with the same uuid
// (live-verified) — rows are merged here. No posted date anywhere.
export async function rippling(token: string, company: string): Promise<RawJob[]> {
  const data = await getJSON(`https://api.rippling.com/platform/api/ats/v1/board/${token}/jobs`);
  const rows: any[] = Array.isArray(data) ? data : [];
  const byId = new Map<string, RawJob>();
  for (const j of rows) {
    if (!j?.uuid || !j?.name) continue;
    const loc = j.workLocation?.label ?? "";
    const prev = byId.get(String(j.uuid));
    if (prev) {
      if (loc && !(prev.location ?? "").includes(loc)) prev.location = [prev.location, loc].filter(Boolean).join("; ");
      continue;
    }
    byId.set(String(j.uuid), {
      source: `rippling:${token}`,
      externalId: String(j.uuid),
      url: String(j.url ?? `https://ats.rippling.com/${token}/jobs/${j.uuid}`),
      title: String(j.name).trim(),
      company,
      location: loc,
      remote: /remote/i.test(`${j.name} ${loc}`),
      description: String(j.name), // body lives on the detail endpoint
      postedAt: undefined,
    });
  }
  return [...byId.values()];
}

// Phenom. Every tenant on its own branded domain — token = that host
// (careers.allianz.com). Public /widgets POST, no auth. Curated-only: no
// common host to pattern-match in discovery.
export async function phenom(token: string, company: string): Promise<RawJob[]> {
  const out: RawJob[] = [];
  const SIZE = 100;
  for (let from = 0; from < 3000; from += SIZE) {
    const res = await postJSON(`https://${token}/widgets`, {
      lang: "en_global", deviceType: "desktop", country: "global",
      pageName: "search-results", ddoKey: "refineSearch", sortBy: "",
      subsearch: "", from, jobs: true, counts: true,
      all_fields: ["category", "country", "city"], size: SIZE, clearAll: false,
      jdsource: "facets", isSliderEnable: false, pageId: "page10",
      siteType: "external", keywords: "", global: true,
      selected_fields: {}, locationData: {},
    });
    const rs = res?.refineSearch;
    const rows: any[] = rs?.data?.jobs ?? [];
    for (const j of rows) {
      if (!j?.reqId && !j?.jobId) continue;
      const locs = [j.city, ...(j.multi_location ?? [])].filter(Boolean);
      out.push({
        source: `phenom:${token}`,
        externalId: String(j.reqId ?? j.jobId),
        url: String(j.applyUrl ?? ""),
        title: String(j.title ?? "").trim(),
        company,
        location: [...new Set(locs)].slice(0, 4).join("; "),
        remote: Boolean(j.remote) || /remote/i.test(String(j.type ?? "")),
        // The teaser is cut from the same rich-text field the JD page
        // renders, so it arrives with markup like every other body here.
        // It was the one body field in this file assigned raw.
        description: stripHtml(String(j.descriptionTeaser ?? "")) || String(j.title ?? ""),
        postedAt: j.postedDate ? new Date(j.postedDate) : undefined,
      });
    }
    const total = Number(rs?.totalHits ?? 0);
    if (rows.length === 0 || from + SIZE >= total) break;
  }
  return out;
}

// Gem. Token = board id (jobs.gem.com/<boardId>). Public GraphQL batch
// endpoint. CAUTION (live-verified): unknown boards answer 200 with an empty
// list — indistinguishable from an empty board.
export async function gem(token: string, company: string): Promise<RawJob[]> {
  const res = await fetch(`https://jobs.gem.com/api/public/graphql/batch?board=${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", batch: "true" },
    body: JSON.stringify([
      {
        operationName: "JobBoardList",
        variables: { boardId: token },
        query:
          "query JobBoardList($boardId: String!) { oatsExternalJobPostings(boardId: $boardId) { jobPostings { id extId title locations { name city isoCountry isRemote } job { locationType employmentType } } } }",
      },
    ]),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`gem:${token} -> HTTP ${res.status}`);
  const data = await res.json();
  const rows: any[] = data?.[0]?.data?.oatsExternalJobPostings?.jobPostings ?? [];
  return rows
    .filter((j: any) => j?.extId && j?.title)
    .map((j: any) => {
      const locs = (j.locations ?? [])
        .map((l: any) => l?.name ?? [l?.city, l?.isoCountry].filter(Boolean).join(", "))
        .filter(Boolean);
      return {
        source: `gem:${token}`,
        externalId: String(j.extId),
        url: `https://jobs.gem.com/${token}/${j.extId}`,
        title: String(j.title).trim(),
        company,
        location: [...new Set(locs)].slice(0, 4).join("; ") as string,
        remote: (j.locations ?? []).some((l: any) => l?.isRemote) ||
          /remote/i.test(String(j.job?.locationType ?? "")),
        description: String(j.title), // body sits behind the detail query
        postedAt: undefined, // only on the detail query
      };
    });
}

// Comeet. Token = "<company>/<uid>" from www.comeet.com/jobs/<company>/<uid>.
// The hosted page embeds the per-tenant API token; bootstrap it, then hit the
// documented careers API.
export async function comeet(token: string, company: string): Promise<RawJob[]> {
  const [slug, uid] = token.split("/");
  if (!slug || !uid) return [];
  const html = await getText(`https://www.comeet.com/jobs/${slug}/${uid}`);
  const tok = html.match(/"token"\s*:\s*"([A-F0-9]+)"/i)?.[1];
  if (!tok) throw new Error(`comeet:${token} -> no embedded API token`);
  const rows = await getJSON(
    `https://www.comeet.co/careers-api/2.0/company/${encodeURIComponent(uid)}/positions?token=${tok}&details=true`,
  );
  return (Array.isArray(rows) ? rows : [])
    .filter((j: any) => j?.uid && j?.name)
    .map((j: any) => {
      const loc = j.location ?? {};
      const locStr = loc.name ?? [loc.city, loc.country].filter(Boolean).join(", ");
      return {
        source: `comeet:${token}`,
        externalId: String(j.uid),
        url: String(j.url_comeet_hosted_page ?? j.url_active_page ?? ""),
        title: String(j.name).trim(),
        company,
        location: locStr,
        remote: Boolean(loc.is_remote) || /remote/i.test(String(j.workplace_type ?? "")),
        sections: [
          ["", j.details?.description],
          ["Requirements", j.details?.requirements],
        ],
        description: String(j.name),
        postedAt: j.time_updated ? new Date(j.time_updated) : undefined,
      };
    });
}

// Getro VC-portfolio networks. Token = the board's host (jobs.b2venture.vc);
// the network id is bootstrapped from the page's __NEXT_DATA__. Jobs link to
// each employer's OWN ATS — high-value harvest input, modest as a source.
export async function getro(token: string, company: string): Promise<RawJob[]> {
  const html = await getText(`https://${token}/jobs`);
  const netId = html.match(/"network"\s*:\s*\{\s*"id"\s*:\s*"?(\d+)"?/)?.[1];
  if (!netId) throw new Error(`getro:${token} -> no network id in __NEXT_DATA__`);
  const out: RawJob[] = [];
  for (let page = 0; page < 100; page++) {
    const res = await postJSON(`https://api.getro.com/api/v2/collections/${netId}/search/jobs`, {
      hitsPerPage: 20, page, filters: { page }, query: "",
    });
    const rows: any[] = res?.results?.jobs ?? [];
    for (const j of rows) {
      if (!j?.id || !j?.title) continue;
      out.push({
        source: `getro:${token}`,
        externalId: String(j.id),
        url: String(j.url ?? ""),
        title: String(j.title).trim(),
        company: String(j.organization?.name ?? company),
        location: (j.locations ?? []).filter(Boolean).slice(0, 4).join("; "),
        remote: /remote/i.test(String(j.work_mode ?? "")),
        description: String(j.title),
        postedAt: j.created_at ? new Date(Number(j.created_at) * 1000) : undefined, // unix sec
      });
    }
    const total = Number(res?.results?.count ?? 0);
    if (rows.length === 0 || (page + 1) * 20 >= total) break;
  }
  return out;
}

// Avature. Token = "<host>/<locale>/<site>" (careers.avature.net/en_US/main).
// The SearchJobs RSS feed is the simplest stable surface.
export async function avature(token: string, company: string): Promise<RawJob[]> {
  const xml = await getText(`https://${token}/SearchJobs/feed/?jobRecordsPerPage=500`);
  const items = xml.split(/<item>/i).slice(1);
  return items
    .map((chunk) => {
      const pick = (tag: string) =>
        chunk.match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`, "i"))?.[1]?.trim() ?? "";
      const link = pick("link") || pick("guid");
      const title = stripHtml(pick("title"));
      const desc = stripHtml(pick("description"));
      const id = link.match(/\/(\d+)(?:\?|$)/)?.[1] ?? link;
      return { link, title, desc, id };
    })
    .filter((r) => r.title && r.link)
    .map((r) => ({
      source: `avature:${token}`,
      externalId: String(r.id),
      url: r.link,
      title: r.title,
      company,
      location: r.desc.split(" - ")[0] ?? "", // "Argentina - 7221" convention
      remote: /remote/i.test(`${r.title} ${r.desc}`),
      description: r.desc || r.title,
      postedAt: undefined,
    }));
}

// Radancy (TalentBrew). Token = "<host>/<langPrefix>" (careers.munichre.com/en).
// JSON envelope with an HTML fragment payload. Two live-verified hard rules:
// SearchResultsModuleName must be sent (else silently empty), and
// SearchFiltersModuleName must NOT be (else a multi-MB facet blob attaches).
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
    const totalPages = Number(frag.match(/data-total-pages="(\d+)"/)?.[1] ?? 1);
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
        company,
        location: "", // fragment list-level location markup varies per tenant
        remote: /remote/i.test(inner),
        description: inner,
        postedAt: undefined,
      });
    }
    if (page >= totalPages) break;
  }
  // The anchor regex can catch duplicate links to the same job — dedupe by id.
  const byId = new Map(out.map((j) => [j.externalId, j]));
  return [...byId.values()];
}

// Cornerstone (CSOD). Token = "<sub>@<siteId>" (career-ohb@4); corp name
// defaults to the subdomain. Two-step: scrape the anonymous JWT (+ cookies)
// off the career-site home page, then POST the search API with both.
export async function csod(token: string, company: string): Promise<RawJob[]> {
  const m = token.match(/^([^@]+)@(\d+)$/);
  if (!m) return [];
  const [, sub, siteId] = m;
  const origin = `https://${sub}.csod.com`;
  const homeRes = await fetch(`${origin}/ux/ats/careersite/${siteId}/home?c=${sub}`, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; JobRadar/0.1)" },
    signal: AbortSignal.timeout(30_000),
  });
  const html = await homeRes.text();
  const jwt = html.match(/"token"\s*:\s*"([A-Za-z0-9._-]+)"/)?.[1];
  if (!jwt) throw new Error(`csod:${token} -> no anonymous token on home page`);
  const cookies = homeRes.headers.get("set-cookie") ?? "";
  const out: RawJob[] = [];
  for (let page = 1; page <= 60; page++) {
    const res = await fetch(`${origin}/services/x/career-site/v1/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${jwt}`,
        Cookie: cookies.split(",").map((c) => c.split(";")[0]).join("; "),
        "User-Agent": "Mozilla/5.0 (compatible; JobRadar/0.1)",
      },
      body: JSON.stringify({
        careerSiteId: Number(siteId), careerSitePageId: Number(siteId),
        pageNumber: page, pageSize: 50, cultureId: 1, cultureName: "en-US",
        searchText: "", states: [], countryCodes: [], cities: [], placeID: "",
        radius: null, postingsWithinDays: null, customFieldCheckboxKeys: [],
        customFieldDropdowns: [], customFieldRadios: [],
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`csod:${token} search -> HTTP ${res.status}`);
    const data = await res.json();
    const rows: any[] = data?.data?.requisitions ?? [];
    for (const j of rows) {
      if (!j?.requisitionId) continue;
      const locs = (j.locations ?? [])
        .map((l: any) => [l.city, l.state, l.country].filter(Boolean).join(", "))
        .filter(Boolean)
        .join("; ");
      out.push({
        source: `csod:${token}`,
        externalId: String(j.requisitionId),
        url: `${origin}/ux/ats/careersite/${siteId}/home/requisition/${j.requisitionId}?c=${sub}`,
        title: String(j.displayJobTitle ?? "").trim(),
        company,
        location: locs,
        remote: /remote/i.test(`${j.displayJobTitle} ${locs}`),
        description: String(j.displayJobTitle ?? ""),
        postedAt: j.postingEffectiveDate ? new Date(j.postingEffectiveDate) : undefined,
      });
    }
    const total = Number(data?.data?.totalCount ?? 0);
    if (rows.length === 0 || page * 50 >= total) break;
  }
  return out;
}

// Jobvite. Token = board slug. Bootstrap the companyEId off the hosted board
// (the fr=true&nl=1 params are load-bearing — bare URLs 302 to branded
// sites), then pull the full XML feed. app.jobvite.com rate-limits hard
// (429 from the 2nd rapid request) — one feed call per run is fine.
export async function jobvite(token: string, company: string): Promise<RawJob[]> {
  const html = await getText(`https://jobs.jobvite.com/${token}?fr=true&nl=1`);
  const eid = html.match(/companyEId\s*[:=]\s*['"]([A-Za-z0-9_-]{4,40})['"]/)?.[1];
  if (!eid) throw new Error(`jobvite:${token} -> no companyEId on board page`);
  const xml = await getText(`https://app.jobvite.com/CompanyJobs/Xml.aspx?c=${eid}`);
  const items = xml.split(/<job>/i).slice(1);
  return items
    .map((chunk) => {
      const pick = (tag: string) =>
        chunk.match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`, "i"))?.[1]?.trim() ?? "";
      return {
        id: pick("id"), title: stripHtml(pick("title")), region: pick("region"),
        location: stripHtml(pick("location")), date: pick("date"),
        url: pick("detail-url") || pick("apply-url"),
        desc: stripHtml(pick("description")),
      };
    })
    .filter((r) => r.id && r.title)
    .map((r) => ({
      source: `jobvite:${token}`,
      externalId: r.id,
      url: r.url,
      title: r.title,
      company,
      location: [r.location, r.region].filter(Boolean).join(", "),
      remote: /remote/i.test(`${r.title} ${r.location} ${r.region}`),
      description: r.desc || r.title,
      postedAt: r.date ? new Date(r.date) : undefined,
    }));
}

// Softgarden. Token = tenant subdomain. The REST jobslist API is auth-gated
// (401 without a channel key) — the server-rendered widgets page is the
// public surface: one page, all postings, no pagination.
export async function softgarden(token: string, company: string): Promise<RawJob[]> {
  const html = await getText(`https://${token}.softgarden.io/en/widgets/jobs`);
  const out: RawJob[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/<a[^>]+href="[^"]*\/job\/(\d+)\/([^"?]*)[^"]*"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const [, id, slug, inner] = m;
    if (seen.has(id)) continue;
    seen.add(id);
    const title = stripHtml(inner).trim().split("\n")[0];
    if (!title) continue;
    out.push({
      source: `softgarden:${token}`,
      externalId: id,
      url: `https://${token}.softgarden.io/job/${id}/${slug}`,
      title,
      company,
      location: "",
      remote: /remote|home\s*office/i.test(title),
      description: title,
      postedAt: undefined,
    });
  }
  return out;
}

// Uniform shape: fetchers that are single-instance (Greenhouse, Ashby,
// SmartRecruiters, Workable, Recruitee, Personio, Workday) simply ignore the
// region argument.
export type AtsFetcher = (token: string, company: string, region?: string) => Promise<RawJob[]>;

export const atsFetchers = {
  greenhouse,
  lever,
  ashby,
  smartrecruiters,
  workable,
  recruitee,
  personio,
  workday,
  teamtailor,
  bamboohr,
  breezy,
  join,
  pinpoint,
  oracle,
  beesite,
  successfactors,
  eightfold,
  jibe,
  rippling,
  phenom,
  gem,
  comeet,
  getro,
  avature,
  radancy,
  csod,
  jobvite,
  softgarden,
} as const satisfies Record<string, AtsFetcher>;
export type AtsProvider = keyof typeof atsFetchers;
