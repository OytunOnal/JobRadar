import { getJSON, getText, postJSON, stripHtml, type RawJob } from "./types";

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
    description: j.descriptionPlain ?? stripHtml(j.description),
    postedAt: j.createdAt ? new Date(j.createdAt) : undefined,
  }));
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
    description: j.descriptionPlain ?? stripHtml(j.descriptionHtml ?? j.description),
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
    const descriptionHtml = [...block.matchAll(
      /<value>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/value>/g,
    )].map((m) => m[1]).join(" ");
    const title = stripHtml(tag("name"));
    jobs.push({
      source: `personio:${token}`,
      externalId: id,
      url: `https://${token}.jobs.personio.com/job/${id}`,
      title,
      company: stripHtml(tag("subcompany")) || company,
      location: office,
      remote: /remote|home\s*office/i.test(`${office} ${tag("schedule")} ${title}`),
      description: stripHtml(descriptionHtml) || title,
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
} as const satisfies Record<string, AtsFetcher>;
export type AtsProvider = keyof typeof atsFetchers;
