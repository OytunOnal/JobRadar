import { getJSON, stripHtml, type RawJob, type Source } from "./types";

// Keyless JSON-API boards adopted from the awesome-job-boards and
// remote-working-list sweeps (2026-08-21, all live-verified). Each is small
// enough not to deserve its own file.

const FRESH_DAYS = 45;
const freshCutoff = () => Date.now() - FRESH_DAYS * 86_400_000;

// ── The Muse ────────────────────────────────────────────────────────────────
// Public paginated API, ~400k jobs. Aggregator: heavy US share, so we walk
// recency-ordered pages per category and stop as soon as a page turns stale —
// region gates score the rest away.
const MUSE_CATEGORIES = ["Software Engineering", "Data and Analytics", "Product Management"];

export function mapMuseJob(j: any): RawJob | null {
  if (!j?.id || !j?.name) return null;
  const locs = (j.locations ?? []).map((l: any) => l?.name).filter(Boolean);
  return {
    source: "themuse",
    externalId: String(j.id),
    url: String(j.refs?.landing_page ?? ""),
    title: String(j.name),
    company: String(j.company?.name ?? ""),
    location: locs.slice(0, 4).join("; "),
    remote: locs.some((l: string) => /flexible|remote/i.test(l)),
    description: stripHtml(String(j.contents ?? "")).slice(0, 8000) || String(j.name),
    postedAt: j.publication_date ? new Date(j.publication_date) : undefined,
  };
}

export const themuse: Source = {
  name: "themuse",
  async fetch(): Promise<RawJob[]> {
    const out: RawJob[] = [];
    for (const cat of MUSE_CATEGORIES) {
      for (let page = 1; page <= 15; page++) {
        const data = await getJSON(
          `https://www.themuse.com/api/public/jobs?page=${page}&category=${encodeURIComponent(cat)}`,
        );
        const rows: any[] = data?.results ?? [];
        if (rows.length === 0) break;
        let stale = false;
        for (const j of rows) {
          const m = mapMuseJob(j);
          if (!m || !m.url) continue;
          if (m.postedAt && m.postedAt.getTime() < freshCutoff()) { stale = true; continue; }
          out.push(m);
        }
        if (stale || page >= Number(data?.page_count ?? page)) break;
      }
    }
    return out;
  },
};

// ── Duunitori (Finland's biggest board) ─────────────────────────────────────
// Keyless search API; queried per keyword, deduped by id. Finnish headings
// are fine — the taxonomy is multilingual and the LLM tier reads Finnish.
const DUUNITORI_QUERIES = ["ohjelmistokehittäjä", "software", "python", "typescript", "unity", "ai"];

export function mapDuunitoriJob(j: any): RawJob | null {
  // Rows carry no numeric id — the slug is the identity.
  if (!j?.slug || !j?.heading) return null;
  const slug = j.slug;
  return {
    source: "duunitori",
    externalId: String(slug),
    url: `https://duunitori.fi/tyopaikat/tyo/${slug}`,
    title: String(j.heading),
    company: String(j.company_name ?? j.company?.name ?? ""),
    location: [j.municipality_name, "Finland"].filter(Boolean).join(", "),
    remote: /etätyö|remote/i.test(`${j.heading} ${j.descr ?? ""}`),
    description: stripHtml(String(j.descr ?? "")).slice(0, 8000) || String(j.heading),
    postedAt: j.date_posted ? new Date(j.date_posted) : undefined,
  };
}

export const duunitori: Source = {
  name: "duunitori",
  async fetch(): Promise<RawJob[]> {
    const byId = new Map<string, RawJob>();
    for (const q of DUUNITORI_QUERIES) {
      let url = `https://duunitori.fi/api/v1/jobentries?search=${encodeURIComponent(q)}`;
      for (let page = 0; page < 8 && url; page++) {
        const data = await getJSON(url);
        for (const j of data?.results ?? []) {
          const m = mapDuunitoriJob(j);
          if (m && !byId.has(m.externalId)) byId.set(m.externalId, m);
        }
        url = data?.next ?? "";
      }
    }
    return [...byId.values()];
  },
};

// ── warpjobs (LLM inference / ML systems niche) ─────────────────────────────
// Jobs re-served from Greenhouse/Lever/Ashby with a structured visa flag;
// dedup against our direct ATS ingestion happens in the normal funnel.
export function mapWarpJob(j: any): RawJob | null {
  const url = j?.url ?? j?.apply_url ?? j?.link;
  if (!j?.title || !url) return null;
  return {
    source: "warpjobs",
    externalId: String(j.id ?? url),
    url: String(url),
    title: String(j.title),
    company: String(j.company ?? j.company_name ?? ""),
    location: String(j.location ?? j.region ?? ""),
    remote: Boolean(j.remote) || /remote/i.test(String(j.location ?? "")),
    salaryText: j.salary ? String(j.salary) : undefined,
    description: stripHtml(String(j.description ?? "")).slice(0, 8000) || String(j.title),
    postedAt: j.posted_at ?? j.date ? new Date(j.posted_at ?? j.date) : undefined,
    visa: j.visa_sponsor === true || j.visa_sponsor === "yes" ? "yes" : undefined,
  };
}

export const warpjobs: Source = {
  name: "warpjobs",
  async fetch(): Promise<RawJob[]> {
    const data = await getJSON("https://warpjobs.com/jobs.json");
    const rows: any[] = Array.isArray(data) ? data : data?.jobs ?? [];
    return rows.map(mapWarpJob).filter((j): j is RawJob => j !== null);
  },
};

// ── AI Dev Jobs (aidevboard.com) ────────────────────────────────────────────
export const aidevjobs: Source = {
  name: "aidevjobs",
  async fetch(): Promise<RawJob[]> {
    const out: RawJob[] = [];
    for (let page = 1; page <= 10; page++) {
      const data = await getJSON(`https://aidevboard.com/api/v1/jobs?tags=llm&page=${page}`);
      const rows: any[] = data?.jobs ?? data?.results ?? data?.data ?? [];
      if (rows.length === 0) break;
      for (const j of rows) {
        const url = j?.apply_url ?? j?.url ?? j?.link;
        if (!j?.title || !url) continue;
        out.push({
          source: "aidevjobs",
          externalId: String(j.id ?? url),
          url: String(url),
          title: String(j.title),
          company: String(j.company ?? j.company_name ?? ""),
          location: String(j.location ?? ""),
          remote: Boolean(j.remote) || /remote/i.test(String(j.location ?? "")),
          salaryText: j.salary ? String(j.salary) : undefined,
          description: stripHtml(String(j.description ?? "")).slice(0, 8000) || String(j.title),
          postedAt: j.posted_at ?? j.published_at ? new Date(j.posted_at ?? j.published_at) : undefined,
        });
      }
    }
    return out;
  },
};

// ── WeJob (francophone Switzerland) ─────────────────────────────────────────
export const wejob: Source = {
  name: "wejob",
  async fetch(): Promise<RawJob[]> {
    const data = await getJSON("https://wejob.ch/api/jobs");
    const rows: any[] = data?.data ?? [];
    return rows
      .filter((j: any) => j?.id && j?.title)
      .map((j: any) => ({
        source: "wejob",
        externalId: String(j.id),
        url: `https://wejob.ch${j.links?.self ?? `/jobs/${j.id}`}`,
        title: String(j.title),
        company: String(j.company?.name ?? j.company_name ?? ""),
        location: String(j.location ?? j.city ?? "Switzerland"),
        remote: /remote|télétravail/i.test(`${j.title} ${j.description ?? ""}`),
        description: stripHtml(String(j.description ?? "")).slice(0, 8000) || String(j.title),
        postedAt: j.published_at ?? j.created_at ? new Date(j.published_at ?? j.created_at) : undefined,
      }));
  },
};
