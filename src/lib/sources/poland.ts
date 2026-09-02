import { stripHtml, type RawJob, type Source } from "./types";

// Poland's two big tech boards, both with keyless JSON APIs (contracts
// learned from career-ops' providers). Neither takes a keyword parameter the
// way we use them — both are pulled newest-first and the keyword scorer
// filters; the freshness window stops pagination.
//
//   justjoin.it   GET  /api/candidate-api/offers  (cursor pagination)
//   nofluffjobs   GET  /api/posting               (whole catalog, one request)
//
// nofluffjobs moved from the windowed POST search to the full catalog after
// the 2026-09 market scan (docs/ats-market-scan.md) verified the endpoint:
// one unauthenticated GET returns every live posting (~19k, PL/HU/CZ/SK/UA
// and more — the old mapper hardcoded ", Poland" onto Hungarian jobs). Full
// coverage also means a sighting-diff can delist for this board, which a
// newest-first window never could. The catalog list is title-only; the body
// lives at /api/posting/{slug} and desc:fill fetches it for rows that earn
// it (the SmartRecruiters trade).
//
// The catalog endpoint's WAF refuses non-browser user agents (the honest
// JobRadar UA gets blocked); it gets a browser UA, the one place here.
//
// Config: POLAND_WINDOW_DAYS (7, justjoin)  POLAND_MAX_PAGES (3, x100/page)
//         NOFLUFF_MAX (25k sanity cap, not a quota)

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

const NOFLUFF_COUNTRIES: Record<string, string> = {
  POL: "Poland", HUN: "Hungary", CZE: "Czechia", SVK: "Slovakia",
  UKR: "Ukraine", NLD: "Netherlands", DEU: "Germany", ESP: "Spain",
  HRV: "Croatia", ROU: "Romania", BEL: "Belgium",
};

export function mapNoFluff(p: any): RawJob | null {
  const title = String(p?.title ?? "").trim();
  const slug = String(p?.url ?? p?.id ?? "").trim();
  if (!title || !slug) return null;
  const place = p.location?.places?.[0];
  const city = place?.city ?? "";
  // The catalog is six countries, not one — the windowed-era mapper stamped
  // ", Poland" onto every row, and the catalog's 4.5k Hungarian postings
  // would all have worn it.
  const country = NOFLUFF_COUNTRIES[place?.country?.code ?? ""] ?? place?.country?.name ?? "Poland";
  const remote = Boolean(p.fullyRemote) || Boolean(p.location?.fullyRemote) || /remote/i.test(String(city));
  const s = p.salary;
  const salary = s?.from && s?.disclosedAt !== "HIDDEN"
    ? `${s.from}–${s.to ?? s.from} ${s.currency ?? "PLN"}/${String(s.period ?? s.type ?? "month").toLowerCase()}`
    : undefined;
  return {
    source: "nofluffjobs",
    externalId: slug,
    url: `https://nofluffjobs.com/pl/job/${slug}`,
    title,
    company: String(p.name ?? "").trim(),
    location: city && !/remote/i.test(city) ? `${city}, ${country}` : country,
    remote,
    // fullyRemote is the board's own structured flag — a statement. False is
    // the flag's resting state and stays silent.
    workMode: remote ? ("remote" as const) : undefined,
    salaryText: salary,
    sections: [
      ["", `${(Array.isArray(p.seniority) ? p.seniority : []).join("/")} ${title}${p.category ? ` — ${p.category}` : ""}`.trim()],
      ["Requirements", (Array.isArray(p.tiles?.values) ? p.tiles.values : [])
        .map((v: any) => v?.value).filter(Boolean).map((v: string) => `- ${v}`).join("\n")],
    ],
    description: title,
    postedAt: typeof p.posted === "number" ? new Date(p.posted) : undefined,
  };
}

const NOFLUFF_MAX = Number(process.env.NOFLUFF_MAX) || 25_000;
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

export async function fetchNoFluff(fetchImpl: typeof fetch = fetch): Promise<RawJob[]> {
  const res = await fetchImpl("https://nofluffjobs.com/api/posting", {
    headers: { "User-Agent": BROWSER_UA, Accept: "application/json" },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`nofluffjobs catalog -> HTTP ${res.status}`);
  const data: any = await res.json();
  const list: any[] = Array.isArray(data?.postings) ? data.postings : [];
  return list.slice(0, NOFLUFF_MAX).map(mapNoFluff).filter((j): j is RawJob => j !== null);
}

/** The posting body, for desc:fill — the catalog list is title-only. */
export async function fetchNoFluffDetail(externalId: string): Promise<string> {
  const res = await fetch(`https://nofluffjobs.com/api/posting/${encodeURIComponent(externalId)}`, {
    headers: { "User-Agent": BROWSER_UA, Accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) return "";
  const d: any = await res.json();
  const req = d?.requirements;
  // The endpoint ships HTML; every sibling in desc:fill's switch returns
  // text, so this one does too — stripHtml preserves the block structure the
  // section parser reads.
  return [
    stripHtml(String(d?.details?.description ?? "")),
    Array.isArray(req?.musts) ? `Requirements: ${req.musts.map((m: any) => m?.value ?? "").filter(Boolean).join(", ")}.` : "",
    Array.isArray(req?.nices) ? `Nice to have: ${req.nices.map((m: any) => m?.value ?? "").filter(Boolean).join(", ")}.` : "",
    stripHtml(String(req?.description ?? "")),
  ].filter(Boolean).join("\n\n").trim();
}

// The windowed POST-search fetch this replaced, kept callable for one release
// in case the catalog endpoint's WAF posture changes; delete on next visit.
async function fetchNoFluffWindowed(fetchImpl: typeof fetch = fetch): Promise<RawJob[]> {
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
void fetchNoFluffWindowed; // retired, kept one release (see comment above)
export const nofluffjobs: Source = { name: "nofluffjobs", fetch: () => fetchNoFluff() };
