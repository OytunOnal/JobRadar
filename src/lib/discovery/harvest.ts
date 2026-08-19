import { extractSlug, type SlugHit } from "./extract";
import { upsertCandidates } from "./store";

// Harvest discovery source: mines ATS board slugs out of the job URLs that
// already flow through ingest. Aggregator listings — even junk ones — usually
// point somewhere real; whatever ATS identity they reveal becomes an AtsBoard
// candidate, and from then on that company's postings can come from the
// official API instead of the aggregator.
//
// Three tiers, cheap to expensive:
//   1. extractSlug on the URL itself           (free, no network)
//   2. follow the redirect chain, slug at hops (1 request)
//   3. scan the final HTML for ATS links/embeds (the same request's body)
// Tiers 2-3 run only for URLs worth resolving (see shouldResolve) and only
// within a per-ingest budget, so harvest can never balloon an ingest run.

// Login walls and SEO farms: a resolve can never reach an ATS through these.
const SKIP_DOMAINS = [
  "linkedin.com", "indeed.com", "glassdoor.com", "glassdoor.co.uk",
  "ziprecruiter.com", "upwork.com", "whatjobs.com", "mysmartpros.com",
  "jooble.org", "talent.com", "bebee.com", "learn4good.com", "jobtome.com",
  // NOTE: adzuna.* is deliberately NOT here — Adzuna job URLs are its own
  // /land/ad redirect bridges, and following them is the whole point of tier 2.
];

export function shouldResolve(rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  return !SKIP_DOMAINS.some((d) => host === d || host.endsWith("." + d));
}

// Drift telemetry: hosts that smell like an ATS but match no registered
// pattern — early warning for new platforms/domains (the way job-boards.*
// would have been caught before we knew about it).
const ATS_SMELL_RE = /(^|\.)(jobs?|careers?|apply|recruiting|talent)\.|greenhouse|lever|ashby|workday|recruitee|personio|smartrecruiters|workable|bamboohr|breezy|teamtailor/i;

export function smellsLikeAts(host: string): boolean {
  return ATS_SMELL_RE.test(host);
}

// Pull every absolute (or protocol-relative) URL out of an HTML/text blob and
// run each through the extractor. Catches apply links and career-site embeds
// (Greenhouse iframes carry the slug in ?for=).
const URL_IN_TEXT_RE = /(?:https?:)?\/\/[a-z0-9.-]+\.[a-z]{2,}[^\s"'<>\\)]*/gi;

export function scanTextForSlugs(text: string): { hits: SlugHit[]; smells: string[] } {
  const hits: SlugHit[] = [];
  const smells = new Set<string>();
  const seen = new Set<string>();
  for (const m of text.matchAll(URL_IN_TEXT_RE)) {
    const raw = m[0].startsWith("//") ? "https:" + m[0] : m[0];
    if (seen.has(raw)) continue;
    seen.add(raw);
    const hit = extractSlug(raw);
    if (hit) {
      hits.push(hit);
    } else {
      try {
        const host = new URL(raw).hostname.toLowerCase();
        if (smellsLikeAts(host)) smells.add(host);
      } catch {
        /* malformed scraped URL — ignore */
      }
    }
  }
  return { hits, smells: [...smells] };
}

const MAX_HOPS = 5;
const MAX_BODY_BYTES = 500_000;

export interface ResolveResult {
  hits: SlugHit[];
  smells: string[];
}

// Tier 2 + 3 for one URL: walk the redirect chain manually (a Location header
// is often the ATS URL itself), then scan the final HTML body.
export async function resolveUrl(
  rawUrl: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 8000,
): Promise<ResolveResult> {
  const hits: SlugHit[] = [];
  const smells = new Set<string>();
  let current = rawUrl;

  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const res = await fetchImpl(current, {
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "User-Agent": "JobRadar/0.1 (personal job search)" },
    });

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) break;
      const next = new URL(loc, current).toString();
      const hit = extractSlug(next);
      if (hit) {
        hits.push(hit);
        return { hits, smells: [...smells] };
      }
      try {
        const host = new URL(next).hostname.toLowerCase();
        if (smellsLikeAts(host)) smells.add(host);
      } catch { /* bad Location value */ }
      if (!shouldResolve(next)) break; // redirected into a wall — stop
      current = next;
      continue;
    }

    if (res.status === 200) {
      const type = res.headers.get("content-type") ?? "";
      if (/html|xml|text/i.test(type)) {
        const body = (await res.text()).slice(0, MAX_BODY_BYTES);
        const scanned = scanTextForSlugs(body);
        hits.push(...scanned.hits);
        for (const s of scanned.smells) smells.add(s);
      }
    }
    break; // non-redirect: chain is over either way
  }

  return { hits, smells: [...smells] };
}

export interface HarvestReport {
  scanned: number; // URLs considered
  resolved: number; // network resolves performed (tier 2/3)
  candidates: number; // new AtsBoard rows written
  known: number; // hits that were already in AtsBoard
  atsLikeHosts: string[]; // unmatched hosts worth a look (drift telemetry)
  errors: number;
}

export interface HarvestOptions {
  // Only these URLs get network resolves; the rest are tier-1 scanned for free.
  resolveUrls?: Iterable<string>;
  maxResolves?: number;
  concurrency?: number;
  fetchImpl?: typeof fetch;
}

// Main entry: tier-1 scans every URL; tier-2/3 resolves the subset in
// opts.resolveUrls (ingest passes only this run's newly-stored aggregator
// jobs there, which keeps harvest naturally incremental).
export async function harvest(
  allUrls: Iterable<string>,
  opts: HarvestOptions = {},
): Promise<HarvestReport> {
  const report: HarvestReport = {
    scanned: 0,
    resolved: 0,
    candidates: 0,
    known: 0,
    atsLikeHosts: [],
    errors: 0,
  };
  const hits: SlugHit[] = [];
  const smells = new Set<string>();

  const pendingResolve: string[] = [];
  const tier1Seen = new Set<string>();
  const resolveSet = new Set(opts.resolveUrls ?? []);

  for (const url of allUrls) {
    if (!url || tier1Seen.has(url)) continue;
    tier1Seen.add(url);
    report.scanned++;
    const hit = extractSlug(url);
    if (hit) {
      hits.push(hit);
    } else if (resolveSet.has(url) && shouldResolve(url)) {
      pendingResolve.push(url);
    }
  }

  const maxResolves = opts.maxResolves ?? 50;
  const queue = pendingResolve.slice(0, maxResolves);
  const workers = Array.from(
    { length: Math.min(opts.concurrency ?? 5, queue.length) },
    async () => {
      while (queue.length > 0) {
        const url = queue.shift()!;
        try {
          const r = await resolveUrl(url, opts.fetchImpl ?? fetch);
          report.resolved++;
          hits.push(...r.hits);
          for (const s of r.smells) smells.add(s);
        } catch {
          report.errors++;
        }
      }
    },
  );
  await Promise.all(workers);

  const stored = await upsertCandidates(hits, "harvest");
  report.candidates = stored.created;
  report.known = stored.known;
  report.atsLikeHosts = [...smells].slice(0, 10);
  return report;
}
