import { createHash } from "node:crypto";
import { prisma } from "./db";
import { scoreJob } from "./score";
import { arbeitnow } from "./sources/arbeitnow";
import { remotive } from "./sources/remotive";
import { remoteok } from "./sources/remoteok";
import { jobicy } from "./sources/jobicy";
import { himalayas } from "./sources/himalayas";
import { weworkremotely } from "./sources/weworkremotely";
import { adzuna } from "./sources/adzuna";
import { jsearch } from "./sources/jsearch";
import { linkedin } from "./sources/linkedin";
import { indeed } from "./sources/indeed";
import { freehire } from "./sources/freehire";
import { arbeitsagentur } from "./sources/arbeitsagentur";
import { eures } from "./sources/eures";
import { sweden } from "./sources/sweden";
import { denmark } from "./sources/denmark";
import { switzerland } from "./sources/switzerland";
import { hn } from "./sources/hn";
import { landingjobs } from "./sources/landingjobs";
import { swissdevjobs } from "./sources/swissdevjobs";
import { berlinstartupjobs } from "./sources/berlinstartupjobs";
import { manfred } from "./sources/manfred";
import { netempregos } from "./sources/netempregos";
import { wttj } from "./sources/wttj";
import { greenjobsde } from "./sources/greenjobsde";
import { germantechjobs } from "./sources/germantechjobs";
import { themuse, duunitori, warpjobs, aidevjobs, wejob } from "./sources/apiboards";
import { rssSources } from "./sources/rssfeeds";
import { vdab } from "./sources/vdab";
import { justjoin, nofluffjobs } from "./sources/poland";
import { thehub } from "./sources/thehub";
import { agenticjobs, a16zspeedrun } from "./sources/nichejobs";
import { workingnomads } from "./sources/workingnomads";
import { jobindexdk } from "./sources/jobindexdk";
import { companySources } from "./sources/companies";
import { analyzeFit, verdictFields } from "./fit";
import { llmEnabled, RateLimitError } from "./llm";
import { harvest, type HarvestReport } from "./discovery/harvest";
import { boardSources, parseBoardSourceName, recordBoardOutcome } from "./discovery/boardSources";
import { tooOldToStore } from "./freshness";
import { canonicalJobUrl, isJunkJobUrl, sourceTrust } from "./domains";
import { findDuplicate } from "./dedup";
import { runNameProbes, type NameProbeReport } from "./discovery/nameprobe";
import { runDeepProbes, type DeepProbeReport } from "./discovery/deepprobe";
import { runLivenessSweep, type LivenessReport } from "./liveness";
import { isRegisteredSponsor, refreshSponsors, sponsorsStale, type SponsorRefreshReport } from "./sponsors";
import { safeSlice, type RawJob, type Source } from "./sources/types";
import { htmlToText, looksLikeHtml, TEXT_VERSION } from "./html-text";
import { labelledSections } from "./sections";
import { invalidateVector } from "./embed";
import { andWhere, openWhere } from "./pool";
import { derivedFields, statedFields, STORE_THRESHOLD } from "./derive";
import { visaFields } from "./visa-write";
import { normalizeLocation, resolveCountry } from "./geo";
import { detectVisa } from "./visa";
import { loadLocationCache, resolveUnknownLocations, resolveWithCache, type LocResolveReport } from "./locresolve";

// How many top-keyword-scored jobs to auto-analyze with the LLM per ingest.
// Bounded to keep token cost + rate-limit pressure predictable.
const AUTO_FIT_TOP_N = 25;

// Semantic-dedup budgets per ingest: how many new jobs get a title prefilter
// at all (fast tier), and how many full comparisons (strong tier) may run.
// The first trial run showed unbudgeted prefilters eating the free tiers.
const DEDUP_MAX_CHECKS = 60;

// Companies name-guess-probed per ingest (harvest tier 4).
const NAME_PROBE_MAX = Number(process.env.NAME_PROBE_MAX) || 8;
// Name-probe misses deep-checked per ingest (tier 5: website -> careers scan).
const DEEP_PROBE_MAX = Number(process.env.DEEP_PROBE_MAX) || 6;
const DEDUP_MAX_COMPARES = 15;

// Rate-sensitive sources keep their own cadence regardless of how often
// ingest runs (the user's rule: LinkedIn guest API stays personal/low-volume,
// weekly). Days between fetches; sources not listed run every ingest.
export const SOURCE_COOLDOWN_DAYS: Record<string, number> = {
  linkedin: 5, // the 103-search matrix — weekly with slack for early runs
};

export function isOnCooldown(name: string, lastFetchedAt: Date | null, now = new Date()): boolean {
  const days = SOURCE_COOLDOWN_DAYS[name];
  if (!days || !lastFetchedAt) return false;
  return now.getTime() - lastFetchedAt.getTime() < days * 86_400_000;
}

export const aggregators: Source[] = [
  arbeitnow,
  remotive,
  remoteok,
  jobicy,
  himalayas,
  weworkremotely,
  freehire,       // keyless aggregator; first-party ATS links feed harvest too
  arbeitsagentur, // German national job board, keyless; German titles matter
  eures,          // EU official portal: werk.nl/SEPE/IEFP/France Travail content
  sweden,         // Arbetsförmedlingen JobTech API, keyless
  denmark,        // Jobnet BFF API, keyless (Cloudflare-tolerant)
  switzerland,    // SECO Job-Room API, keyless; de+fr titles
  hn,             // monthly "Ask HN: Who is hiring?" via Algolia; ATS links feed harvest
  landingjobs,    // Landing.Jobs (PT-centric, relocation flag), keyless
  swissdevjobs,   // SwissDevJobs: structured visa/workMode/salary, keyless
  berlinstartupjobs, // Berlin startup scene via WP RSS (Cloudflare-tolerant)
  manfred,        // Spanish tech platform, open API; two-stage detail
  netempregos,    // Portugal's biggest general board, RSS -> IT slice
  wttj,           // Welcome to the Jungle via its public Algolia index (FR+)
  vdab,           // Flanders' public employment service, self-healing key
  justjoin,       // justjoin.it — Poland tech, cursor-paged
  nofluffjobs,    // nofluffjobs.com — Poland tech, salary-transparent
  thehub,         // Nordic startups (EU + remote passes)
  agenticjobs,    // AI-agent engineering niche (visa flag as data)
  a16zspeedrun,   // a16z SPEEDRUN portfolio (games/AI)
  workingnomads,  // remote board via its public Elasticsearch endpoint
  jobindexdk,     // Denmark's biggest private board, RSS per query
  greenjobsde,    // German sustainability board via Atom feed (awesome-sustainability-jobs)
  germantechjobs, // structured visa flags, SwissDevJobs engine — Germany focus
  themuse,        // The Muse public API — recency-walked, category-filtered
  duunitori,      // Finland's biggest board, keyless search API
  warpjobs,       // LLM inference / ML-systems niche, visa flag
  aidevjobs,      // aidevboard.com AI jobs API
  wejob,          // francophone Switzerland JSON API
  ...rssSources,  // 66 curated RSS/Atom job feeds (see rssfeeds.ts)
  adzuna,   // needs ADZUNA_APP_ID + ADZUNA_APP_KEY; skips itself otherwise
  jsearch,  // needs RAPIDAPI_KEY; skips itself otherwise
  // linkedin removed from the automatic set (user decision 2026-08-21): it
  // will return as a manually-triggered button; the connector stays in
  // sources/linkedin.ts, and the SourceState cooldown still guards it.
  indeed,   // needs APIFY_API_TOKEN; kaix actor, DACH countries by default
];


function dedupeKey(job: RawJob): string {
  return createHash("sha1")
    .update(`${job.source}:${job.externalId}`)
    .digest("hex");
}

// Normalize a title/company so the same role from different sources collapses:
// drop parentheticals ("(Remote)", "(m/f/d)"), punctuation, and extra spaces.
function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Should a re-sighting overwrite the description we already stored?
//
// Not unconditionally. Several connectors put only the TITLE in the list
// payload because the board's list endpoint carries no body, and desc:fill
// enriches those later from the detail page. A blind overwrite would throw
// that enrichment away on every sweep. The reverse case matters too: a posting
// really is edited at its source, and until now we kept our first sighting of
// it forever.
//
// So take the incoming text only when it is better, and treat STRUCTURE as
// quality — a version with headings and bullets beats a longer flat one,
// because the section parser can only read what has line breaks.
// STORE ONE SIGHTING: create the posting, or fold this sighting into the row
// that already represents it.
//
// Extracted from the ingest loop so it can be CALLED — by the loop, and by a
// test. Everything this decides used to live inside a 612-line function with a
// database singleton and ~140 network sources between a test and the decision,
// which is why the only test that touches this area re-implements the `kept`
// rule in the test file rather than exercising it: delete the real line and the
// test still passes.
//
// `identity` is the create-path row: the caller assembles it because it holds
// the run-scoped caches (location, sponsor register) and the dedupe keys.
export async function storeSighting(
  job: RawJob,
  ctx: {
    key: string;
    ck: string;
    country: string | null;
    sponsorReg: boolean;
    identity: Record<string, unknown>;
  },
): Promise<{ kind: "created"; id: string } | { kind: "updated"; id: string }> {
  const { key, ck, country, sponsorReg } = ctx;

  // Exact same-source match, or the same role stored under a different source.
  const withText = { include: { content: { select: { description: true } } } } as const;
  const existing =
    (await prisma.job.findUnique({ where: { dedupeKey: key }, ...withText })) ??
    (await prisma.job.findFirst({ where: { contentKey: ck }, ...withText }));

  if (!existing) {
    const created = await prisma.job.create({
      data: {
        ...ctx.identity,
        content: { create: { description: safeSlice(job.description, 8000), textVersion: TEXT_VERSION } },
        listings: { create: { event: "listed", source: job.source, at: new Date() } },
      } as never,
    });
    return { kind: "created", id: created.id };
  }

  // Derive from the text we are going to KEEP, not the text that just arrived.
  //
  // These are not always the same, and the difference was undoing desc:fill's
  // work on every sweep. Several platforms' list payloads carry only the title,
  // so desc:fill fetches the real body from the detail endpoint; betterText then
  // correctly refuses to overwrite that body with the next sweep's title-only
  // payload — but the score was recomputed from the payload regardless,
  // collapsing to a title-only score and often crossing back below the gate. The
  // posting kept its good text and lost the score that text had earned.
  const keepIncoming = betterText(job.description, existing.content?.description);
  const kept = keepIncoming ? job.description : existing.content?.description ?? job.description;

  // Refresh what the source states and what its text makes true, but never
  // clobber the user's pipeline status/notes.
  await prisma.job.update({
    where: { id: existing.id },
    data: {
      ...statedFields(job),
      ...derivedFields({ ...job, description: kept }, {
        country,
        sponsorReg,
        current: {
          visa: existing.visa, visaBy: existing.visaBy,
          seniorityLevel: existing.seniorityLevel, seniorityBy: existing.seniorityBy,
          sponsorReg, source: existing.source, country,
        },
      }),
      country,
      contentKey: ck,
      // Refresh the stored text when the board now offers a better one. This is
      // how structure comes back to postings ingested before htmlToText: the old
      // stripHtml collapsed every newline, so ~half the pool is flat prose that
      // only a re-sighting can repair.
      ...(keepIncoming
        ? {
            content: {
              upsert: {
                create: { description: safeSlice(kept, 8000), textVersion: TEXT_VERSION },
                update: { description: safeSlice(kept, 8000), textVersion: TEXT_VERSION },
              },
            },
          }
        : {}),
      // Pool-diff freshness: the job is still listed at its source.
      lastSeenAt: new Date(),
      delistedAt: null, // it's back (or never left)
      ...(existing.delistedAt
        ? { listings: { create: { event: "relisted", source: job.source, at: new Date() } } }
        : {}),
    },
  });
  // A rewritten description invalidates the vector built from it — the same
  // rule the score, langReq and seniority already follow.
  if (keepIncoming) await invalidateVector(prisma, existing.id);
  return { kind: "updated", id: existing.id };
}

export function betterText(incoming: string, current: string | null | undefined): boolean {
  if (!current?.trim()) return true;
  const inStruct = incoming.includes("\n");
  const curStruct = current.includes("\n");
  if (!inStruct && curStruct) return false; // never flatten what we already have
  if (inStruct && !curStruct) return incoming.length >= current.length * 0.8;
  return incoming.length > current.length * 1.1; // meaningfully richer
}

function contentKey(job: RawJob): string {
  return createHash("sha1")
    .update(`${norm(job.title)}|${norm(job.company)}`)
    .digest("hex");
}

export interface IngestReport {
  fetched: number;
  scored: number;
  stored: number;
  updated: number;
  duplicates: number;
  fitAnalyzed: number;
  perSource: Record<string, number>;
  tooOld: number;
  junkDomain: number;
  // Postings whose connector handed us markup. Non-zero is a connector bug.
  unconverted: number;
  // Per-gate elimination counts (negative/roleNegative/noSignal/region/
  // noMatch/belowThreshold) — the false-negative audit surface.
  eliminated: Record<string, number>;
  semanticDupes: number;
  delisted: number;
  nameProbe?: NameProbeReport;
  deepProbe?: DeepProbeReport;
  liveness?: LivenessReport;
  sponsors?: SponsorRefreshReport;
  locations?: LocResolveReport;
  errors: string[];
  harvest?: HarvestReport;
}

// Aggregator jobs carry foreign URLs worth harvesting for ATS identities;
// ATS-sourced jobs (source "gh:x", "lever:x", ...) already reveal theirs.
function isAggregatorJob(job: RawJob): boolean {
  return !job.source.includes(":");
}

export interface IngestOptions {
  // Full-pool board sweep mode: ONLY discovered boards (no curated feeds, no
  // aggregators, no sponsor refresh, no harvest/probes/liveness, no LLM
  // layers). Run in slices so job batches never pile up in memory; the
  // stalest-first rotation advances the pool one slice per call.
  boardsOnly?: boolean;
  boardLimit?: number;
  // Run only these sources. Names are matched against the source's own name
  // ("eures", "freehire") and against a board's platform prefix
  // ("recruitee" matches every recruitee:token board), because the two kinds
  // of source are named differently but a user thinks of both as "recruitee".
  //
  // The reason this exists: repairing text. 5,667 postings still hold what
  // the old stripHtml wrote, and their connectors have since been fixed — so
  // a re-fetch of THOSE sources rewrites them (ingest keeps the better text).
  // A full sweep would do it too, in hours, while also pulling half a million
  // postings nobody asked for.
  only?: string[];
}

export async function runIngest(opts: IngestOptions = {}): Promise<IngestReport> {
  const report: IngestReport = {
    fetched: 0,
    scored: 0,
    stored: 0,
    updated: 0,
    duplicates: 0,
    fitAnalyzed: 0,
    perSource: {},
    tooOld: 0,
    unconverted: 0,
    junkDomain: 0,
  eliminated: {},
    semanticDupes: 0,
    delisted: 0,
    errors: [],
  };

  // Source order decides who wins dedupe: curated ATS feeds first, then
  // discovered boards (also direct-apply), aggregators last — so when the same
  // role arrives from several places, the official ATS listing is the one kept.
  // "Lean" runs do the fetch/store/delist core and nothing else: no sponsor
  // refresh, no discovery harvest, no name/deep probes, no liveness sweep, no
  // LLM auto-fit. boardsOnly meant that already; a targeted --only run wants
  // exactly the same thing, since its whole purpose is to rewrite the text of
  // a handful of sources in minutes rather than hours.
  const lean = Boolean(opts.boardsOnly || opts.only?.length);

  let discovered: Source[] = [];
  try {
    discovered = await boardSources(opts.boardLimit);
  } catch (e: any) {
    report.errors.push(`boardSources: ${e.message}`);
  }
  let sources: Source[] = opts.boardsOnly
    ? discovered
    : [...companySources(), ...discovered, ...aggregators];

  if (opts.only?.length) {
    const wanted = new Set(opts.only.map((s) => s.trim().toLowerCase()).filter(Boolean));
    sources = sources.filter((s) => {
      const name = s.name.toLowerCase();
      // "recruitee" must select recruitee:acme, recruitee:foo, ... while
      // "eures" selects the aggregator of that exact name.
      return wanted.has(name) || wanted.has(name.split(":")[0]);
    });
  }

  // Visa-sponsor registers: refresh when older than two weeks (isolated —
  // a register outage never sinks the ingest).
  if (!lean) {
    try {
      if (await sponsorsStale()) report.sponsors = await refreshSponsors();
    } catch (e: any) {
      report.errors.push(`sponsors: ${String(e.message).slice(0, 160)}`);
    }
  }

  const all: RawJob[] = [];
  const sourceStates = new Map(
    (await prisma.sourceState.findMany()).map((s) => [s.name, s.lastFetchedAt]),
  );

  // sink: where this source's jobs land. The parallel normal-ingest path
  // passes a per-source bucket so results can be reassembled in PRIORITY
  // order after concurrent fetching — dedupe order is about assembly, not
  // fetch timing.
  const fetchOne = async (src: Source, sink: RawJob[] = all): Promise<void> => {
    if (isOnCooldown(src.name, sourceStates.get(src.name) ?? null)) {
      report.perSource[src.name] = -1; // sentinel: skipped on cooldown
      return;
    }
    try {
      const jobs = await src.fetch();
      if (src.name in SOURCE_COOLDOWN_DAYS) {
        await prisma.sourceState.upsert({
          where: { name: src.name },
          update: { lastFetchedAt: new Date() },
          create: { name: src.name, lastFetchedAt: new Date() },
        });
      }
      report.perSource[src.name] = jobs.length;
      sink.push(...jobs);
      // Adaptive frequency: tell the board how it did against the keyword
      // threshold, so no-hit boards get fetched less often over time.
      if (src.name.startsWith("board:")) {
        const passed = jobs.filter((j) => {
          const s = scoreJob(j);
          return !s.disqualified && s.score >= STORE_THRESHOLD;
        }).length;
        await recordBoardOutcome(src.name, jobs.length, passed).catch(() => {});
      }
    } catch (e: any) {
      report.errors.push(`${src.name}: ${e.message}`);
      report.perSource[src.name] = 0;
      // A failed board still counts as ATTEMPTED: stamp + back off, or the
      // stalest-first rotation re-selects the same failing cluster forever.
      if (src.name.startsWith("board:")) {
        const key = parseBoardSourceName(src.name);
        if (key) {
          await prisma.atsBoard.updateMany({
            where: { platform: key.platform, token: key.token, region: key.region },
            data: { lastFetchedAt: new Date() },
          }).catch(() => {});
          await recordBoardOutcome(src.name, 0, 0).catch(() => {});
        }
      }
    }
  };

  if (opts.boardsOnly) {
    // Sweep mode: boards are independent companies, so ordering carries no
    // dedupe priority — fetch them through a RAM-adaptive worker pool.
    //
    // Two politeness lessons learned live:
    //  - The pool arrives in PLATFORM BLOCKS (crawl insertion order), so a
    //    slice can be 1500 consecutive requests to one host. Shuffle first:
    //    mixed platforms spread the concurrency across distinct hosts.
    //  - Single-host platforms (join.com; apply.workable.com 429'd at 8-wide
    //    live) additionally get a PER-PLATFORM in-flight cap.
    for (let i = sources.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [sources[i], sources[j]] = [sources[j], sources[i]];
    }
    const base = Math.min(Number(process.env.SWEEP_CONCURRENCY) || 8, 16);
    const PER_PLATFORM_CAP: Record<string, number> = { join: 2, workable: 2, recruitee: 2 };
    const platformOf = (name: string): string => name.split(":")[1] ?? "";
    const limitNow = (): number => {
      const heapMB = process.memoryUsage().heapUsed / 1_048_576;
      if (heapMB > 1200) return 1;
      if (heapMB > 800) return Math.max(2, Math.floor(base / 2));
      return base;
    };
    const queue = [...sources];
    const inFlight = new Map<string, number>();
    let active = 0;
    await new Promise<void>((resolve) => {
      const pump = (): void => {
        while (active < limitNow()) {
          // First queued source whose platform is under its cap.
          const qi = queue.findIndex((s) => {
            const p = platformOf(s.name);
            return (inFlight.get(p) ?? 0) < (PER_PLATFORM_CAP[p] ?? base);
          });
          if (qi === -1) break;
          const src = queue.splice(qi, 1)[0];
          const p = platformOf(src.name);
          inFlight.set(p, (inFlight.get(p) ?? 0) + 1);
          active++;
          void fetchOne(src).finally(() => {
            inFlight.set(p, (inFlight.get(p) ?? 0) - 1);
            active--;
            pump();
          });
        }
        if (queue.length === 0 && active === 0) resolve();
      };
      pump();
    });
  } else {
    // Normal ingest: PARALLEL fetch, sequential priority. Source order only
    // matters at dedupe time, so each source fetches into its own bucket
    // concurrently and the buckets are concatenated in the original priority
    // order afterwards — same dedupe outcome, wall time ~= slowest source
    // instead of the sum. Heap-aware like the sweep pool; shared-host
    // platforms keep a politeness cap.
    const buckets: RawJob[][] = sources.map(() => []);
    const CAP: Record<string, number> = { join: 2, workable: 2, recruitee: 2 };
    const hostKey = (name: string): string => name.split(":")[0];
    const conc = Math.min(Number(process.env.INGEST_CONCURRENCY) || 6, 12);
    const limitNow = (): number => {
      const heapMB = process.memoryUsage().heapUsed / 1_048_576;
      if (heapMB > 1200) return 1;
      if (heapMB > 800) return Math.max(2, Math.floor(conc / 2));
      return conc;
    };
    const pending = sources.map((_, i) => i);
    const inFlight = new Map<string, number>();
    let active = 0;
    await new Promise<void>((resolve) => {
      const pump = (): void => {
        while (active < limitNow()) {
          const qi = pending.findIndex((i) => {
            const h = hostKey(sources[i].name);
            return (inFlight.get(h) ?? 0) < (CAP[h] ?? conc);
          });
          if (qi === -1) break;
          const i = pending.splice(qi, 1)[0];
          const h = hostKey(sources[i].name);
          inFlight.set(h, (inFlight.get(h) ?? 0) + 1);
          active++;
          void fetchOne(sources[i], buckets[i]).finally(() => {
            inFlight.set(h, (inFlight.get(h) ?? 0) - 1);
            active--;
            pump();
          });
        }
        if (pending.length === 0 && active === 0) resolve();
      };
      pump();
    });
    // One retry pass for sources that failed (timeouts included): transient
    // hiccups get a second chance in the same run; a second failure stays in
    // report.errors for investigation.
    for (let i = 0; i < sources.length; i++) {
      const s = sources[i];
      if (report.perSource[s.name] === 0 && report.errors.some((e) => e.startsWith(`${s.name}:`))) {
        await fetchOne(s, buckets[i]);
      }
    }
    // Priority-ordered assembly — this is where "source order wins dedupe"
    // actually happens.
    for (const b of buckets) all.push(...b);
  }
  report.fetched = all.length;

  // Track content keys seen within this run so the same role from two sources
  // doesn't get stored twice.
  const seenContent = new Set<string>();
  let storeFailures = 0;

  // Harvest inputs: every aggregator URL gets a free tier-1 scan (junk and
  // disqualified jobs included — their URLs still reveal ATS identities);
  // network resolves are spent only on this run's newly-stored jobs.
  // Location resolution: gazetteer + learned cache now; whatever is left
  // goes into one batched LLM call after the store loop.
  const locationCache = await loadLocationCache().catch(() => new Map<string, string | null>());
  const unknownLocations = new Map<string, Set<string>>();

  const aggregatorUrls: string[] = [];
  const newlyStoredUrls: string[] = [];
  const newlyCreated: Array<{ id: string; title: string; company: string; description: string; source: string }> = [];
  for (const job of all) {
    if (isAggregatorJob(job) && job.url) aggregatorUrls.push(job.url);
  }

  for (const job of all) {
    // A source that splits its body into named blocks told us so; assembling
    // those blocks into one text is OUR decision, and it moves whenever the
    // section parser does. Eight adapters used to make it themselves.
    //
    // The adapter's own `description` stays as the fallback for when every
    // block came back empty — Lever's structure-destroyed descriptionPlain,
    // Personio's unpaired <value> blocks, a bare title.
    if (job.sections?.length) {
      const assembled = labelledSections(job.sections);
      if (assembled) job.description = assembled;
    }
    // A LAST LINE, NOT A CONVERSION STEP.
    //
    // Converting here unconditionally would be wrong: several connectors
    // SYNTHESIZE a plain-text description (SwissDevJobs' "Technologies: ..."
    // line, a16z's "title · function · seniority"), and htmlToText treats
    // `<` followed by a letter as a tag — so a stack listing `<T>` or
    // `<canvas>` would lose those tokens. (Measured while writing the test
    // for this: the surrounding words survive, because the match stops at the
    // first `>`. Prose like "latency < 100ms" is safe either way — the regex
    // requires a letter after the bracket.)
    //
    // looksLikeHtml is narrow enough to tell the two apart: it fires only on
    // real tag names and a handful of entities. So this converts what is
    // genuinely markup, leaves synthesized prose alone, and COUNTS it —
    // because a connector reaching here is a connector bug, and a silent
    // repair would hide it. Measured when this landed: 1 posting in 3,577.
    //
    // It matters more than the count suggests. betterText judges quality by
    // the presence of newlines, and raw markup has plenty, so unconverted
    // markup can WIN against clean text on a re-sighting — and TEXT_VERSION
    // is stamped either way, so the repair queue sees it as current.
    if (looksLikeHtml(job.description)) {
      report.unconverted++;
      job.description = htmlToText(job.description);
    }
    // SEO-farm copies: the original arrives via a better source.
    if (isJunkJobUrl(job.url)) {
      report.junkDomain++;
      continue;
    }
    // Freshness guard: aggregator reposts of old listings are noise — skip
    // before spending anything on them. (Their URL was still harvested above.)
    if (tooOldToStore(job.postedAt, isAggregatorJob(job))) {
      report.tooOld++;
      continue;
    }
    const s = scoreJob(job);
    // Store-all: gate-rejected jobs are STORED with disqualified=true instead
    // of dropped — a scorer fix becomes a local re-score, and "high embedding
    // similarity but disqualified" doubles as a gate-mistake detector. The
    // report still counts them under their gate so sweep summaries read the
    // same as before.
    const rejected = s.disqualified || s.score < STORE_THRESHOLD;
    if (rejected) {
      const gate = s.disqualified
        ? (s.reason.startsWith("Excluded") ? "negative"
          : s.reason.startsWith("Non-eng") ? "roleNegative"
          : s.reason.startsWith("No engineering") ? "noSignal"
          : s.reason.startsWith("Region") ? "region" : "noMatch")
        : "belowThreshold";
      report.eliminated[gate] = (report.eliminated[gate] ?? 0) + 1;
    } else {
      report.scored++;
    }

    const key = dedupeKey(job);
    const ck = contentKey(job);

    // Same role already handled this run (from an earlier, higher-priority source).
    if (seenContent.has(ck)) {
      report.duplicates++;
      continue;
    }
    seenContent.add(ck);

    const country = resolveWithCache(job.location, locationCache);
    // Company-level signal from the public sponsor registers (nl/gb/dk/ie).
    const sponsorReg = await isRegisteredSponsor(job.company, country);

    const data = {
      // Identity, and our own observation of it. Everything else on the row is
      // either what the source states (statedFields) or what its text makes
      // true (derivedFields), and neither of those belongs in a literal here.
      dedupeKey: key,
      contentKey: ck,
      source: job.source,
      externalId: job.externalId,
      country,
      ...statedFields(job),
      ...derivedFields(job, { country, sponsorReg }),
      // Sources parse dates from wild formats; one NaN Date must degrade to
      // "date unknown", never kill the whole run (it took down a sweep slice).
      postedAt: job.postedAt && !Number.isNaN(job.postedAt.getTime()) ? job.postedAt : null,
    };

    if (job.location && country === null && resolveCountry(job.location) === null) {
      const key = normalizeLocation(job.location);
      if (!locationCache.has(key)) {
        if (!unknownLocations.has(key)) unknownLocations.set(key, new Set());
        unknownLocations.get(key)!.add(job.location);
      }
    }

    // Per-job isolation: a single poison row (invalid date, lone surrogate,
    // whatever tomorrow brings) must cost ONE job, never a 53k-board run —
    // this is the third crash class caught here, so guard the class.
    try {

    const outcome = await storeSighting(job, { key, ck, country, sponsorReg, identity: data });
    if (outcome.kind === "updated") {
      report.updated++;
    } else {
      report.stored++;
      newlyCreated.push({ id: outcome.id, title: job.title, company: job.company, description: job.description, source: job.source });
      if (isAggregatorJob(job) && job.url) newlyStoredUrls.push(job.url);
    }

    } catch (e: any) {
      storeFailures++;
      if (storeFailures <= 5) {
        report.errors.push(`store ${job.source}/${job.externalId}: ${String(e.message).slice(0, 140)}`);
      }
    }
  }
  if (storeFailures > 5) report.errors.push(`store: ${storeFailures - 5} more row failures suppressed`);

  // Sweep: a direct source was fetched and returned jobs, yet some stored
  // rows of that source were absent from the feed — those roles are closed.
  // Stamp them immediately (no grace); a failing/empty fetch sweeps nothing.
  const seenBySource = new Map<string, Set<string>>();
  for (const job of all) {
    if (!job.source.includes(":")) continue;
    if (!seenBySource.has(job.source)) seenBySource.set(job.source, new Set());
    seenBySource.get(job.source)!.add(job.externalId);
  }
  let swept = 0;
  for (const [src, seen] of seenBySource) {
    if (seen.size === 0) continue;
    const stored = await prisma.job.findMany({
      where: { source: src, delistedAt: null },
      select: { id: true, externalId: true },
    });
    for (const row of stored) {
      if (!seen.has(row.externalId)) {
        await prisma.job.update({
          where: { id: row.id },
          data: { delistedAt: new Date(), listings: { create: { event: "delisted", source: src, at: new Date() } } },
        });
        swept++;
      }
    }
  }
  report.delisted = swept;

  // Discovery harvest: mine ATS board candidates from the aggregator URLs.
  // Isolated so no harvest failure can sink the ingest.
  if (lean) return report; // fetch + store + delist only
  try {
    report.harvest = await harvest(aggregatorUrls, { resolveUrls: newlyStoredUrls });
  } catch (e: any) {
    report.errors.push(`harvest: ${e.message}`);
  }

  // Harvest tier 4: aggregator jobs carry no company URL, but the company
  // NAME slugifies into probeable ATS tokens. Verified hits join the board
  // pool as active — the whole company upgrades to first-party next ingest.
  try {
    const names = newlyCreated
      .filter((j) => !j.source.includes(":"))
      .map((j) => j.company)
      .filter(Boolean);
    if (names.length > 0) report.nameProbe = await runNameProbes(names, NAME_PROBE_MAX);
  } catch (e: any) {
    report.errors.push(`name-probe: ${String(e.message).slice(0, 160)}`);
  }

  // Harvest tier 5: rescue lane for name-probe misses — LLM resolves the
  // company website, the careers page reveals the ATS, probe verifies.
  if (llmEnabled()) {
    try {
      report.deepProbe = await runDeepProbes(DEEP_PROBE_MAX);
    } catch (e: any) {
      report.errors.push(`deep-probe: ${String(e.message).slice(0, 160)}`);
    }
  }

  // Liveness probing: aggregator jobs have no diffable feed, so aging ones
  // get their URLs probed for closure banners (isolated like the harvests).
  try {
    report.liveness = await runLivenessSweep();
  } catch (e: any) {
    report.errors.push(`liveness: ${String(e.message).slice(0, 160)}`);
  }

  // Batched LLM location resolution for strings the gazetteer+cache missed.
  if (llmEnabled() && unknownLocations.size > 0) {
    try {
      report.locations = await resolveUnknownLocations(unknownLocations);
    } catch (e: any) {
      report.errors.push(`locations: ${String(e.message).slice(0, 160)}`);
    }
  }

  // Semantic dedup: is a newly stored job the same OPPORTUNITY as one we
  // already track from the same company (repost / reworded / per-city)?
  // Cheap funnel: no same-company rows → no LLM call at all; a titles-only
  // fast-tier pass gates the expensive full comparison. Budgeted per ingest.
  if (llmEnabled() && newlyCreated.length > 0) {
    let compareBudget = DEDUP_MAX_COMPARES;
    let dedupErrors = 0;
    for (const nj of newlyCreated.slice(0, DEDUP_MAX_CHECKS)) {
      if (compareBudget <= 0) break;
      try {
        const candidates = await prisma.job.findMany({
          where: { company: nj.company, id: { not: nj.id }, duplicateOfId: null },
          orderBy: { lastSeenAt: "desc" },
          take: 12,
          select: { id: true, title: true, content: { select: { description: true } } },
        });
        if (candidates.length === 0) continue;
        const outcome = await findDuplicate(
          nj,
          candidates.map((c) => ({ id: c.id, title: c.title, description: c.content?.description ?? c.title })),
        );
        compareBudget -= outcome.compareCalls;
        if (outcome.duplicateOfId) {
          await prisma.job.update({ where: { id: nj.id }, data: { duplicateOfId: outcome.duplicateOfId } });
          // A repost proves the original role is still open.
          await prisma.job.update({ where: { id: outcome.duplicateOfId }, data: { lastSeenAt: new Date() } });
          report.semanticDupes++;
        }
      } catch (e: any) {
        if (e instanceof RateLimitError) {
          report.errors.push(`dedup stopped: token budget reached (${report.semanticDupes} found)`);
          break;
        }
        // One line per failure flooded the first trial's report — summarize.
        dedupErrors++;
        if (dedupErrors <= 3) report.errors.push(`dedup ${nj.id}: ${e.message}`);
      }
    }
    if (dedupErrors > 3) report.errors.push(`dedup: ${dedupErrors - 3} more failures suppressed`);
  }

  // Auto-analyze the top-keyword jobs with the LLM (CV vs job description) so the
  // dashboard can rank by real fit, not just keyword score. No-ops without a key.
  if (llmEnabled()) {
    const toAnalyze = await prisma.job.findMany({
      // openWhere, not a hand-written near-copy. The copy omitted delistedAt,
      // so the one queue that ran right after a fetch was also the one queue
      // that would spend a minute of LLM time on a posting already closed.
      where: andWhere(openWhere(), { fitScore: null }),
      orderBy: { score: "desc" },
      take: AUTO_FIT_TOP_N,
      include: { content: { select: { description: true } } },
    });
    for (const j of toAnalyze) {
      try {
        const fit = await analyzeFit({ ...j, description: j.content?.description ?? j.title });
        if (!fit) continue;
        await prisma.job.update({
          where: { id: j.id },
          // The model read the posting: an explicit refusal beats "unknown",
          // and verdictFields is what makes that a proper llm-strength write
          // with the tier recomputed and the history row appended.
          data: verdictFields(fit, "auto-fit", j),
        });
        report.fitAnalyzed++;
        // Throttle to stay under the provider's per-minute token limit.
        await new Promise((r) => setTimeout(r, 1500));
      } catch (e: any) {
        // Out of daily tokens — stop analyzing, keep everything else. Remaining
        // jobs stay fitScore:null and get picked up on the next ingest.
        if (e instanceof RateLimitError) {
          report.errors.push(`fit stopped: daily token budget reached (${report.fitAnalyzed} analyzed)`);
          break;
        }
        report.errors.push(`fit ${j.id}: ${e.message}`);
      }
    }
  }

  // Dashboard snapshot: the stat strip reads this one row instead of
  // group-by'ing half a million.
  try {
    const [statusCounts, verdictCounts, total] = await Promise.all([
      prisma.job.groupBy({ by: ["status"], _count: true, where: { disqualified: false } }),
      prisma.job.groupBy({ by: ["fitVerdict"], _count: true, where: { disqualified: false } }),
      prisma.job.count(),
    ]);
    await prisma.dashboardStatsSnapshot.create({
      data: {
        at: new Date(),
        stats: JSON.stringify({
          total,
          byStatus: Object.fromEntries(statusCounts.map((c) => [c.status, c._count])),
          byVerdict: Object.fromEntries(verdictCounts.map((c) => [c.fitVerdict ?? "unscored", c._count])),
        }),
      },
    });
  } catch (e: any) {
    report.errors.push(`snapshot: ${String(e.message).slice(0, 100)}`);
  }

  return report;
}
