import { prisma } from "../db";
import { liveWhere } from "../queue/pool";
import { parseJoinState } from "../sources/ats/join";
import { probeBoard } from "./validate";

// Harvest tier 4: name-guess probing. LinkedIn (and most aggregators) never
// expose the company's own site — but they give us the company NAME, and most
// companies use name-derived ATS slugs. So: slugify the name, probe our
// platforms, and verify the hit by comparing the API's returned company name
// (the gh:peak lesson — a live slug can belong to a different company).
//
// Only platforms whose probe returns a company name participate: a hit we
// can't verify is worse than no hit. Every attempt is cached forever in
// CompanyProbe — a name is probed once, ever.

// Platforms whose probe body carries a company name (see validate.ts).
// manatal joined 2026-09-03: its registry probe hits the company-meta
// endpoint (real org name, clean 404s), so it verifies like the others; the
// live-posting count needs one follow-up call, like greenhouse. Pinpoint was
// evaluated the same day and CANNOT join: postings.json carries no company
// name, and a nameless 200 cannot tell a hit from a stranger (the gh:peak
// lesson). Adding a platform here changes PROBE_SIGNATURE, which correctly
// re-stales every cached miss — coverage grew, old "not found" answers aged.
// hrmanager joined 2026-09-03 (#40): one unauthenticated call returns both
// the tenant's real name and its whole-board count, and a non-tenant answers
// HTTP 400 rather than a soft 200 - the cleanest negative of any platform
// here. Measured on 223 real Nordic companies from our own pool: 8 tenants
// (3.6%), matching the sponsor-register lane's rate.
const VERIFIABLE_PLATFORMS = ["greenhouse", "workable", "recruitee", "smartrecruiters", "personio", "manatal", "hrmanager"] as const;

// Platforms whose probe body carries NO name, but whose public pages do:
// Ashby's board page title ("Clera Jobs"), Teamtailor's RSS channel title,
// JOIN's embedded Next.js state. Verified by fetching that page and matching
// the identity it carries — measured need: Replika and Oneflow sat in the
// miss cache while their Teamtailor boards were live (#2).
const HTML_VERIFIABLE = ["ashby", "join", "teamtailor"] as const;

// The coverage fingerprint a verdict was produced under. A cached miss only
// means "not found on THESE platforms" — when the list grows, every old miss
// silently stops being an answer. Staleness is cache invalidation: the
// invalidator is the list itself, never a hand-bumped constant someone
// forgets to touch.
export const PROBE_SIGNATURE = [...VERIFIABLE_PLATFORMS, ...HTML_VERIFIABLE].sort().join(",");

// A miss from an older (or unknown) platform set deserves a re-probe; a hit
// never goes stale — the board it found is real regardless of coverage.
export function isStaleMiss(row: { found: boolean; probeVersion: string | null }): boolean {
  return !row.found && row.probeVersion !== PROBE_SIGNATURE;
}

// Legal suffixes carry no identity; product words (Games, Labs, Studio) DO —
// stripping "Games" would turn Dream Games into a different company.
const LEGAL_SUFFIX_RE =
  /\b(gmbh|inc|ltd|llc|ag|plc|corp|corporation|limited|b\.?v\.?|n\.?v\.?|s\.?a\.?|s\.?l\.?|s\.?a\.?s|sarl|a\/s|aps|ab|oy|kft|sp\.? z ?o\.?o\.?)\b\.?/gi;

export function normalizeCompanyName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // fold diacritics: Müller → Muller
    .toLowerCase()
    .replace(LEGAL_SUFFIX_RE, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// "Dream Games GmbH" → ["dreamgames", "dream-games"]. Too-short names ("EY")
// produce nothing — short slugs collide with unrelated companies too easily.
export function slugCandidates(name: string): string[] {
  const words = normalizeCompanyName(name).split(" ").filter(Boolean);
  if (words.length === 0) return [];
  const joined = words.join("");
  if (joined.length < 4) return [];
  const out = [joined];
  if (words.length > 1) out.push(words.join("-"));
  return out;
}

// Same company? Normalized equality or containment either way.
// "Peak Physical Therapy" vs "Peak Games" → no. "Azumo" vs "Azumo Inc" → yes.
export function namesMatch(a: string, b: string): boolean {
  const na = normalizeCompanyName(a).replace(/ /g, "");
  const nb = normalizeCompanyName(b).replace(/ /g, "");
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

export interface NameProbeHit {
  platform: string;
  token: string;
  companyName: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Between candidate tokens, not between platforms. One request per host per
// token, then a breath — so a single host sees roughly one request a second
// during a long run, which is gentler than any board fetch we already do.
const PROBE_PAUSE_MS = Number(process.env.PROBE_PAUSE_MS) || 400;

// Greenhouse's validation probe hits the board ROOT (no job list), so the
// live-posting requirement needs one extra call for greenhouse hits only.
async function manatalJobCount(token: string): Promise<number> {
  try {
    const res = await fetch(
      `https://www.careers-page.com/api/v1.0/c/${encodeURIComponent(token)}/jobs/?page=1&page_size=1`,
      { signal: AbortSignal.timeout(10_000) },
    );
    if (!res.ok) return 0;
    const data = await res.json();
    return typeof data?.count === "number" ? data.count : 0;
  } catch {
    return 0;
  }
}

async function greenhouseJobCount(token: string): Promise<number> {
  try {
    const res = await fetch(`https://boards-api.greenhouse.io/v1/boards/${token}/jobs`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return 0;
    const data = await res.json();
    return Array.isArray(data?.jobs) ? data.jobs.length : 0;
  } catch {
    return 0;
  }
}

// Board pages bury the identity in boilerplate: "Clera Jobs", "Jobs at X |
// JOIN", "Careers at X". Strip the frame, keep the name; namesMatch does the
// rest. Never strip on bare hyphens — "e-bot7" is a name.
export function boardTitleName(title: string): string {
  return title
    .replace(/^\s*<!\[CDATA\[/, "")
    .replace(/\]\]>\s*$/, "")
    .replace(/\s*\|[^|]*$/, "") // trailing "| JOIN", "| Teamtailor"
    .replace(/^\s*(jobs|careers|karriere)\s+(at|bei)\s+/i, "")
    .replace(/\s+(jobs|careers|karriere)\s*$/i, "")
    .trim();
}

// Seam for the HTML tier: fetch a public page, redirects followed (a
// Teamtailor token CNAMEd to a custom career domain still answers through
// its RSS redirect — the Replika case).
export type HtmlProbeFn = (url: string) => Promise<{ status: number; text: string } | null>;

const defaultHtmlProbe: HtmlProbeFn = async (url) => {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "JobRadar/0.1 (personal job search)" },
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
    });
    return { status: res.status, text: res.status === 200 ? await res.text() : "" };
  } catch {
    return null;
  }
};

// Identity + live-posting count from the public page of a platform whose API
// carries no name. null = no verifiable board there.
async function htmlVerify(
  platform: (typeof HTML_VERIFIABLE)[number],
  token: string,
  htmlProbe: HtmlProbeFn,
): Promise<{ companyName: string; jobCount: number } | null> {
  if (platform === "teamtailor") {
    const r = await htmlProbe(`https://${token}.teamtailor.com/jobs.rss`);
    if (!r || r.status !== 200) return null;
    const channel = r.text.split(/<item>/i)[0];
    const raw = channel.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
    if (!raw) return null;
    const jobCount = r.text.split(/<item>/i).length - 1;
    return { companyName: boardTitleName(raw), jobCount };
  }
  if (platform === "join") {
    const r = await htmlProbe(`https://join.com/companies/${token}`);
    if (!r || r.status !== 200) return null;
    const state = parseJoinState(r.text);
    const fromState = state?.company?.name;
    const fromTitle = r.text.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
    const name = fromState || (fromTitle ? boardTitleName(fromTitle) : null);
    if (!name) return null;
    const jobCount = Array.isArray(state?.jobs?.items) ? state.jobs.items.length : 0;
    return { companyName: String(name), jobCount };
  }
  // ashby: the posting API has the jobs but no org name — the board page
  // title has the org name but no jobs. Two fetches, one verdict.
  const r = await htmlProbe(`https://jobs.ashbyhq.com/${encodeURIComponent(token)}`);
  if (!r || r.status !== 200) return null;
  const raw = r.text.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  if (!raw) return null;
  return { companyName: boardTitleName(raw), jobCount: -1 }; // count comes from the API probe
}

// Probe one company across the verifiable platforms; first VERIFIED hit wins.
// API-verifiable platforms go first (cheap, deterministic), the HTML tier
// after — same guards on both: name must match, board must carry live jobs.
export async function probeCompany(
  companyName: string,
  probeFn: typeof probeBoard = probeBoard,
  htmlProbe: HtmlProbeFn = defaultHtmlProbe,
): Promise<NameProbeHit | null> {
  const candidates = slugCandidates(companyName);
  for (const token of candidates) {
    // ALL EIGHT PLATFORMS AT ONCE. They are eight different companies'
    // servers — greenhouse, workable, recruitee, smartrecruiters, personio,
    // ashby, join, teamtailor — and a pause between requests to DIFFERENT
    // hosts buys nobody anything. Politeness is a per-host property, and each
    // host still receives exactly one request per candidate token; only the
    // dead time between them is gone.
    //
    // This is the difference between ~10s and ~1.5s per name, which is the
    // difference between a probe budget of 8 per ingest and one that keeps up
    // with the pool: the backlog was 6,621 unprobed companies, growing by
    // ~1,250 a day, against 8 probed per run.
    const [apiOutcomes, htmlOutcomes] = await Promise.all([
      Promise.all(VERIFIABLE_PLATFORMS.map((p) => probeFn(p, token, "").catch(() => null))),
      Promise.all(HTML_VERIFIABLE.map((p) => htmlVerify(p, token, htmlProbe).catch(() => null))),
    ]);
    await sleep(PROBE_PAUSE_MS);

    // Verdicts are READ in the original order, so concurrency changed the
    // schedule and not the answer: the cheap deterministic API tier still
    // wins over the HTML tier whenever both would verify the same name.
    for (const [i, platform] of VERIFIABLE_PLATFORMS.entries()) {
      const outcome = apiOutcomes[i];
      if (!outcome || outcome.result !== "active" || !outcome.companyName) continue;
      if (!namesMatch(companyName, outcome.companyName)) continue; // gh:peak guard
      // Empty boards are squatted/trial accounts, not hiring channels
      // (measured: "workable:jpmorgan" answers with a name and 0 jobs).
      let jobCount = outcome.jobCount;
      if (jobCount === undefined && platform === "greenhouse") {
        jobCount = await greenhouseJobCount(token);
      }
      if (jobCount === undefined && platform === "manatal") {
        jobCount = await manatalJobCount(token);
      }
      if (!jobCount || jobCount < 1) continue;
      return { platform, token, companyName: outcome.companyName };
    }
    for (const [i, platform] of HTML_VERIFIABLE.entries()) {
      const verified = htmlOutcomes[i];
      if (!verified || !namesMatch(companyName, verified.companyName)) continue;
      let jobCount = verified.jobCount;
      if (platform === "ashby") {
        // Live-posting count from the API probe (the page can't tell).
        const outcome = await probeFn("ashby", token, "");
        jobCount = outcome.result === "active" ? (outcome.jobCount ?? 0) : 0;
      }
      if (!jobCount || jobCount < 1) continue;
      return { platform, token, companyName: verified.companyName };
    }
  }
  return null;
}

export interface NameProbeReport {
  checked: number;
  found: number;
}

// Probe up to `budget` new company names; hits land in AtsBoard as ACTIVE
// (we just probed them) and their whole board joins the next ingest.
// THE POOL'S OWN BACKLOG: companies with live aggregator postings and no
// first-party board of their own, best-scoring first.
//
// The ingest used to probe only the companies THAT RUN created, which at a
// budget of 8 could never catch up — measured 2026-09-02, the pool held 6,621
// unprobed companies and was gaining ~1,250 a day. This is a better list than
// any external directory, too: every name is a company hiring right now whose
// posting already passed our scoring gates, and every hit upgrades postings
// the user is ALREADY being shown to first-party sourcing.
//
// Ordering by the company's best posting score is what makes a bounded budget
// spend itself well: the boards worth finding first are the ones whose
// postings the radar would rank highest.
// Some "companies" are not companies. Reddit handles and pasted URLs arrive
// as employer names from the discussion-sourced boards, and each one costs
// eight probes to learn nothing: the backlog's best-scoring head held
// "/u/Beginning-Scholar105 https://www.reddit.com/user/..." before this
// guard. A name with a URL in it, or one long enough to be a sentence, is
// not a company someone runs an ATS under.
export function probeableName(name: string): boolean {
  if (name.length > 60) return false;
  if (/https?:\/\/|www\.|@|\/u\/|\/r\//i.test(name)) return false;
  return slugCandidates(name).length > 0;
}

// The OTHER backlog: names from the government sponsor registers, which sit
// in VisaSponsor rather than in the pool. These never reached the ingest lane
// — seeding them was a hand-run script (#13), so the lane advanced only when
// somebody remembered, and at 157,056 register names against ~1.9s each that
// is 77 hours nobody was ever going to sit through by hand.
//
// ORDER MATTERS MORE HERE THAN IN THE POOL BACKLOG, because the registers are
// wildly unequal in signal. The UK's licensed-sponsor list is 126,493 names
// and includes every care home and restaurant that ever held a licence;
// Czechia's 9,203 are employers who registered a vacancy open to a non-EU
// national THIS MONTH. Alphabetical order — what the hand-run script used —
// would spend the whole budget on the letter A of the largest and weakest
// list. So registers are drained best-signal-first, and within a register the
// order is arbitrary but stable.
export const REGISTER_PRIORITY = ["cz", "pt", "dk", "ie", "nl", "gb"];

export async function registerNames(limit: number): Promise<string[]> {
  if (limit <= 0) return [];
  const probedRows = await prisma.companyProbe.findMany({ select: { name: true } });
  const probed = new Set(probedRows.map((p) => p.name));
  const out: string[] = [];
  for (const country of REGISTER_PRIORITY) {
    if (out.length >= limit) break;
    const rows = await prisma.visaSponsor.findMany({ where: { country }, select: { name: true } });
    for (const r of rows) {
      if (out.length >= limit) break;
      if (!probeableName(r.name)) continue;
      if (probed.has(normalizeCompanyName(r.name))) continue;
      out.push(r.name);
    }
  }
  return out;
}

export async function backlogNames(limit: number): Promise<string[]> {
  const [rows, probedRows] = await Promise.all([
    prisma.job.groupBy({
      by: ["company"],
      where: { ...liveWhere(), NOT: { source: { contains: ":" } } },
      _max: { score: true },
    }),
    prisma.companyProbe.findMany({ select: { name: true } }),
  ]);
  const probed = new Set(probedRows.map((p) => p.name));
  return rows
    .filter((r) => r.company && probeableName(r.company) && !probed.has(normalizeCompanyName(r.company)))
    .sort((a, b) => (b._max.score ?? 0) - (a._max.score ?? 0))
    .slice(0, limit)
    .map((r) => r.company);
}

export async function runNameProbes(
  companyNames: Iterable<string>,
  budget: number,
  probeFn: typeof probeBoard = probeBoard,
  htmlProbe: HtmlProbeFn = defaultHtmlProbe,
  // Which pipe poured these names in. Distinct values let a later measurement
  // ask "what did the sponsor-register seeding actually yield in postings" —
  // the question every growth lane has to answer eventually.
  discoveredVia = "name-probe",
): Promise<NameProbeReport> {
  const report: NameProbeReport = { checked: 0, found: 0 };

  // Names our board table already covers need no probing. Matching is
  // namesMatch-loose, not exact: "Mistral" and "Mistral Ai" are the same
  // company (learned when tier 5 re-discovered a board we already had).
  const knownCollapsed = (await prisma.atsBoard.findMany({ select: { companyName: true } }))
    .map((b) => (b.companyName ? normalizeCompanyName(b.companyName).replace(/ /g, "") : ""))
    .filter((n) => n.length >= 4);
  const isKnown = (norm: string) => {
    const c = norm.replace(/ /g, "");
    if (c.length < 4) return false;
    return knownCollapsed.some((k) => k === c || k.includes(c) || c.includes(k));
  };

  const seen = new Set<string>();
  for (const raw of companyNames) {
    if (report.checked >= budget) break;
    const norm = normalizeCompanyName(raw);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    if (isKnown(norm)) {
      // RECORD the skip, or it is not a skip — it is a treadmill. The first
      // full backlog drain walked 6,410 names, silently passed 5,187 of them
      // here (their boards are already in the table), and because nothing
      // was written, backlogNames offered every one of them again next time:
      // two predicates answering "is this company handled" differently, the
      // exact drift pool.ts exists to prevent. A found=true row with no
      // probeVersion says "covered via the board table, never actually
      // probed", and keeps the cache honest about which it was.
      await prisma.companyProbe.upsert({
        where: { name: norm },
        update: {},
        create: { name: norm, displayName: raw, found: true },
      });
      continue;
    }
    if (slugCandidates(raw).length === 0) continue;
    const cached = await prisma.companyProbe.findUnique({ where: { name: norm } });
    if (cached) continue;

    report.checked++;
    const hit = await probeCompany(raw, probeFn, htmlProbe);
    await prisma.companyProbe.create({
      data: { name: norm, displayName: raw, found: hit !== null, probeVersion: PROBE_SIGNATURE },
    });
    if (hit) {
      report.found++;
      await recordHit(hit, discoveredVia);
    }
    // A probe run is minutes-to-hours of silence otherwise; the seeds' logs
    // are watched by monitors that can only relay what gets printed. A line
    // per hundred makes progress observable without making the log a firehose.
    if (report.checked % 100 === 0) {
      console.log(`  ...${report.checked} probed, ${report.found} found`);
    }
  }

  // Leftover budget goes to stale misses: verdicts recorded under a smaller
  // platform set than today's. Fresh names always come first — a re-probe is
  // a second chance, not a priority.
  if (report.checked < budget) {
    const stale = await prisma.companyProbe.findMany({
      where: {
        found: false,
        OR: [{ probeVersion: null }, { probeVersion: { not: PROBE_SIGNATURE } }],
      },
      orderBy: { createdAt: "asc" },
      take: budget - report.checked,
    });
    for (const row of stale) {
      report.checked++;
      const hit = await probeCompany(row.displayName ?? row.name, probeFn, htmlProbe);
      await prisma.companyProbe.update({
        where: { id: row.id },
        data: { found: hit !== null, probeVersion: PROBE_SIGNATURE },
      });
      if (hit) {
        report.found++;
        await recordHit(hit, discoveredVia);
      }
    }
  }
  return report;
}

async function recordHit(hit: NameProbeHit, discoveredVia: string): Promise<void> {
  await prisma.atsBoard.upsert({
    where: { platform_token_region: { platform: hit.platform, token: hit.token, region: "" } },
    update: {},
    create: {
      platform: hit.platform,
      token: hit.token,
      region: "",
      companyName: hit.companyName,
      status: "active", // we just probed it live
      discoveredVia,
      validatedAt: new Date(),
    },
  });
}
