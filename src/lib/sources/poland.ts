import { type RawJob, type Source } from "./types";

// Poland's two big tech boards, both with keyless JSON APIs (contracts
// learned from career-ops' providers). Neither takes a keyword parameter the
// way we use them — both are pulled newest-first and the keyword scorer
// filters; the freshness window stops pagination.
//
//   justjoin.it   GET  /api/candidate-api/offers  (cursor pagination)
//   nofluffjobs   POST /api/search/posting        (page pagination)
//
// Config: POLAND_WINDOW_DAYS (7)  POLAND_MAX_PAGES (3, x100/page)

const UA = "JobRadar/0.1 (personal job search)";
const WINDOW_DAYS = Number(process.env.POLAND_WINDOW_DAYS) || 7;
const MAX_PAGES = Number(process.env.POLAND_MAX_PAGES) || 3;
const PAGE_SIZE = 100;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── justjoin.it ──────────────────────────────────────────────────────────────

export function mapJustJoin(o: any): RawJob | null {
  const slug = String(o?.slug ?? "").trim();
  const title = String(o?.title ?? "").trim();
  if (!slug || !title) return null;
  const workplace = String(o.workplaceType ?? "").toLowerCase();
  return {
    source: "justjoin",
    externalId: slug,
    url: `https://justjoin.it/job-offer/${slug}`,
    title,
    company: String(o.companyName ?? "").trim(),
    location: o.city ? `${o.city}, Poland` : "Poland",
    remote: workplace === "remote",
    workMode: workplace === "remote" || workplace === "hybrid" || workplace === "office"
      ? (workplace === "office" ? "onsite" : (workplace as "remote" | "hybrid"))
      : undefined,
    // The list payload carries no body, only a skills array — present it as a
    // requirements list so the scorer and the section parser can read it.
    //
    // The entries are objects ({name, level} verified live), and joining them
    // as text is what produced "Mid PHP Symfony Developer, [object Object],
    // [object Object]" in 326 stored postings. The level is real signal the
    // source hands us — "ITIL 5/5" is a harder requirement than "Jira 3/5" —
    // so keep it rather than flattening to a bare name.
    sections: [
      ["", title],
      ["Requirements", (Array.isArray(o.requiredSkills) ? o.requiredSkills : [])
        .map((s: any) => {
          if (typeof s === "string") return `- ${s}`;
          const name = String(s?.name ?? "").trim();
          if (!name) return "";
          return s?.level ? `- ${name} (${s.level}/5)` : `- ${name}`;
        })
        .filter(Boolean).join("\n")],
    ],
    description: title,
    postedAt: o.publishedAt && !Number.isNaN(Date.parse(o.publishedAt)) ? new Date(o.publishedAt) : undefined,
  };
}

export async function fetchJustJoin(fetchImpl: typeof fetch = fetch): Promise<RawJob[]> {
  const cutoff = Date.now() - WINDOW_DAYS * 86_400_000;
  const out: RawJob[] = [];
  let from = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    let data: any;
    try {
      const p = new URLSearchParams({
        from: String(from), itemsCount: String(PAGE_SIZE), currency: "pln",
        orderBy: "descending", sortBy: "publishedAt", keywordType: "any", isPromoted: "true",
      });
      const res = await fetchImpl(`https://justjoin.it/api/candidate-api/offers?${p}`, {
        headers: { "User-Agent": UA, Accept: "application/json" },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) break;
      data = await res.json();
    } catch {
      break;
    }
    const offers: any[] = data?.data ?? [];
    let pageOldest = Infinity;
    for (const o of offers) {
      const job = mapJustJoin(o);
      if (!job) continue;
      const t = job.postedAt?.getTime();
      if (t !== undefined) pageOldest = Math.min(pageOldest, t);
      if (t !== undefined && t < cutoff) continue;
      out.push(job);
    }
    const next = Number(data?.meta?.next?.cursor);
    if (pageOldest < cutoff || offers.length === 0 || !Number.isFinite(next)) break;
    from = next;
    await sleep(400);
  }
  return out;
}

// ── nofluffjobs ──────────────────────────────────────────────────────────────

export function mapNoFluff(p: any): RawJob | null {
  const title = String(p?.title ?? "").trim();
  const slug = String(p?.url ?? p?.id ?? "").trim();
  if (!title || !slug) return null;
  const city = p.location?.places?.[0]?.city ?? "";
  const remote = Boolean(p.fullyRemote) || /remote/i.test(String(city));
  const salary = p.salary?.from
    ? `${p.salary.from}–${p.salary.to ?? p.salary.from} ${p.salary.currency ?? "PLN"}/${p.salary.type ?? "month"}`
    : undefined;
  return {
    source: "nofluffjobs",
    externalId: slug,
    url: `https://nofluffjobs.com/pl/job/${slug}`,
    title,
    company: String(p.name ?? "").trim(),
    location: city && !/remote/i.test(city) ? `${city}, Poland` : "Poland",
    remote,
    salaryText: salary,
    sections: [
      ["", title],
      ["Requirements", (Array.isArray(p.tiles?.values) ? p.tiles.values : [])
        .map((v: any) => v?.value).filter(Boolean).map((v: string) => `- ${v}`).join("\n")],
    ],
    description: title,
    postedAt: typeof p.posted === "number" ? new Date(p.posted) : undefined,
  };
}

export async function fetchNoFluff(fetchImpl: typeof fetch = fetch): Promise<RawJob[]> {
  const cutoff = Date.now() - WINDOW_DAYS * 86_400_000;
  const out: RawJob[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    let data: any;
    try {
      const p = new URLSearchParams({
        sort: "newest", withSalaryMatch: "true", pageTo: String(page),
        pageSize: String(PAGE_SIZE), salaryCurrency: "PLN", salaryPeriod: "month",
        region: "pl", language: "pl-PL",
      });
      const res = await fetchImpl(`https://nofluffjobs.com/api/search/posting?${p}`, {
        method: "POST",
        headers: { "User-Agent": UA, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          criteriaSearch: {
            country: [], withSalaryMatch: [], city: [], more: [], employment: [],
            requirement: [], salary: [], jobPosition: [], applicationStatus: [],
            province: [], company: [], id: [], category: [], keyword: [],
            jobLanguage: [], seniority: [],
          },
          pageSize: PAGE_SIZE,
          withSalaryMatch: true,
        }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) break;
      data = await res.json();
    } catch {
      break;
    }
    const postings: any[] = data?.postings ?? [];
    let pageOldest = Infinity;
    for (const posting of postings) {
      const job = mapNoFluff(posting);
      if (!job || out.some((j) => j.externalId === job.externalId)) continue;
      const t = job.postedAt?.getTime();
      if (t !== undefined) pageOldest = Math.min(pageOldest, t);
      if (t !== undefined && t < cutoff) continue;
      out.push(job);
    }
    if (pageOldest < cutoff || postings.length < PAGE_SIZE) break;
    await sleep(400);
  }
  return out;
}

export const justjoin: Source = { name: "justjoin", fetch: () => fetchJustJoin() };
export const nofluffjobs: Source = { name: "nofluffjobs", fetch: () => fetchNoFluff() };
