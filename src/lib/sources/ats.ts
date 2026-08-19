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
} as const satisfies Record<string, AtsFetcher>;
export type AtsProvider = keyof typeof atsFetchers;
