import { prisma } from "../db";
import { arbeitnow } from "../sources/arbeitnow";
import { remotive } from "../sources/remotive";
import { remoteok } from "../sources/remoteok";
import { jobicy } from "../sources/jobicy";
import { himalayas } from "../sources/himalayas";
import { weworkremotely } from "../sources/weworkremotely";
import { adzuna } from "../sources/adzuna";
import { jsearch } from "../sources/jsearch";
import { linkedin } from "../sources/linkedin";
import { indeed } from "../sources/indeed";
import { freehire } from "../sources/freehire";
import { arbeitsagentur } from "../sources/arbeitsagentur";
import { eures } from "../sources/eures";
import { sweden } from "../sources/sweden";
import { denmark } from "../sources/denmark";
import { switzerland } from "../sources/switzerland";
import { hn } from "../sources/hn";
import { landingjobs } from "../sources/landingjobs";
import { swissdevjobs } from "../sources/swissdevjobs";
import { berlinstartupjobs } from "../sources/berlinstartupjobs";
import { manfred } from "../sources/manfred";
import { netempregos } from "../sources/netempregos";
import { wttj } from "../sources/wttj";
import { greenjobsde } from "../sources/greenjobsde";
import { germantechjobs } from "../sources/germantechjobs";
import { huntukvisasponsors } from "../sources/huntukvisasponsors";
import { visajobsie } from "../sources/visajobsie";
import { englishjobsde } from "../sources/englishjobsde";
import { spainjobsio } from "../sources/spainjobsio";
import { nextleveljobs } from "../sources/nextleveljobs";
import { freework } from "../sources/freework";
import { navno } from "../sources/navno";
import { itjobbank } from "../sources/itjobbank";
import { demando } from "../sources/demando";
import { alfred } from "../sources/alfred";
import { karriereat } from "../sources/karriereat";
import { cercolavoro } from "../sources/cercolavoro";
import { ergodotisi } from "../sources/ergodotisi";
import { jobsch, jobupch } from "../sources/jobsch";
import { startupjobscz, devbg, optius } from "../sources/ldboards";
import { posaohr } from "../sources/posaohr";
import { themuse, duunitori, warpjobs, aidevjobs, wejob } from "../sources/apiboards";
import { rssSources } from "../sources/rssfeeds";
import { vdab } from "../sources/vdab";
import { justjoin, nofluffjobs } from "../sources/poland";
import { thehub } from "../sources/thehub";
import { agenticjobs, a16zspeedrun } from "../sources/nichejobs";
import { workingnomads } from "../sources/workingnomads";
import { jobindexdk } from "../sources/jobindexdk";
import { companySources } from "../sources/companies";
import { analyzeFit, verdictFields } from "../llm/fit";
import { llmEnabled } from "../llm/llm";
import { harvest, type HarvestReport } from "../discovery/harvest";
import { boardSources, parseBoardSourceName, recordBoardOutcome } from "../discovery/boardSources";
import { findDuplicate } from "../scoring/dedup";
import { backlogNames, registerNames, runNameProbes, type NameProbeReport } from "../discovery/nameprobe";
import { runDeepProbes, type DeepProbeReport } from "../discovery/deepprobe";
import { runLivenessSweep, type LivenessReport } from "../liveness";
import { isRegisteredSponsor, refreshSponsors, sponsorsStale, type SponsorRefreshReport } from "../visa/sponsors";
import { safeSlice, type RawJob, type Source } from "../sources/types";
import { TEXT_VERSION } from "../text/html-text";
import { invalidateVector } from "../llm/embed";
import { runValidation, type ValidationReport } from "../discovery/validate";
import { andWhere, openWhere } from "../queue/pool";
import { derivedFields, statedFields } from "../scoring/derive";
import { readQueueGauges, type QueueGauge } from "../queue/capacity";
import { recrawlIfDue, type RecrawlReport } from "../discovery/recrawl";
import { normalizeLocation, resolveCountry } from "../location/geo";
import { loadLocationCache, resolveUnknownLocations, resolveWithCache, type LocResolveReport } from "../location/locresolve";
import { pump, selects, selectSources, wantsAnything, PER_HOST } from "./fetch";
import { pass, stage } from "./stage";
import { intake, isAggregatorJob, readable } from "./intake";
import { scoreJob } from "../scoring/score";
import { rejectedBy } from "../scoring/derive";

// How many top-keyword-scored jobs to auto-analyze with the LLM per ingest.
// Bounded to keep token cost + rate-limit pressure predictable.
const AUTO_FIT_TOP_N = 25;

// Semantic-dedup budgets per ingest: how many new jobs get a title prefilter
// at all (fast tier), and how many full comparisons (strong tier) may run.
// The first trial run showed unbudgeted prefilters eating the free tiers.
const DEDUP_MAX_CHECKS = 60;

// Companies name-guess-probed per ingest (harvest tier 4).
// Sized against the measured inflow: the pool gains ~1,250 unprobed companies
// on a heavy ingest day, and the parallel probe costs ~1.5s a name, so this
// budget covers a day's arrivals and eats into the backlog on quiet days.
// It is the wall-clock cost the queue gauge exists to make visible.
const NAME_PROBE_MAX = Number(process.env.NAME_PROBE_MAX) || 1_500;
// Candidate boards probed per ingest. The first number here was 1,500,
// reasoned backwards from "12 seconds for 60 boards, so 1,500 is about five
// minutes" — which sized the budget by what felt affordable rather than by
// what the lane actually owes, and 1,500 turned out to be less than half of
// it. A cap below the standing workload does not throttle a queue, it makes
// the queue grow forever.
//
// What the lane owes, measured: 72,007 boards carry a validatedAt and
// RECHECK_DAYS is 30, so 2,400 come due every day no matter what discovery
// does. New boards arrive on top — 1,757/day over the last week, though that
// week included bulk archive scanning, so treat it as a burst rather than the
// floor. 4,000 covers the unavoidable recheck plus ordinary discovery with
// room to spare, and costs about thirteen minutes at the measured 0.2s per
// board. Each board is a different company's tenant, so concurrency 10 lands
// on 4,000 different hosts rather than hammering one.
//
// One thing to watch as the board table grows: the recheck cost is
// validated-boards ÷ RECHECK_DAYS, so it rises linearly with discovery. If
// this budget starts binding again, the honest fix is to ask whether every
// board needs re-probing monthly — not to keep raising the number.
const VALIDATE_MAX = Number(process.env.VALIDATE_MAX) || 4_000;
// How much of that budget is reserved for the sponsor registers (#13). The
// pool backlog gets the rest — and inherits anything the registers cannot
// use, so a drained register never wastes budget.
const REGISTER_PROBE_SLICE = Number(process.env.REGISTER_PROBE_SLICE) || 300;
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
  huntukvisasponsors, // UK jobs rated for sponsorship against the gov.uk register; JSON-LD bodies via desc:fill
  visajobsie,     // IE jobs from DETE-screened sponsors; re-serves Akamai-walled IrishJobs rows
  englishjobsde,  // DE visa-sponsorship facet, English-only; clickout apply links, never crawled
  spainjobsio,    // ES curated visa surface via its own ItemList JSON-LD; ai-input=yes robots
  nextleveljobs,  // EU-wide sponsor-curated board; sitemap-fed, JSON-LD bodies at fetch time
  freework,       // FR IT board, EN-GB tech slice; sitemap-fed, JSON-LD bodies at fetch time
  navno,          // NO national ad feed (NAV), cursor-resumed; bodies via desc:fill
  itjobbank,      // DK tech-only board on the Jobindex stack; shared parser, no query matrix
  demando,        // SE tech board; sitemap + JobPosting JSON-LD
  alfred,         // IS dominant board; page-1 __NEXT_DATA__ poller (robots bans deeper)
  karriereat,     // AT dominant board; declared sitemap + JobPosting JSON-LD
  cercolavoro,    // IT board that reopened the country; sitemap + JSON-LD
  ergodotisi,     // CY board, English-language EU market; title + <p> parse
  jobsch,         // CH dominant board; declared EN sitemap + JobPosting JSON-LD
  jobupch,        // CH Romandie sibling of jobs.ch; same platform, own fetch
  startupjobscz,  // CZ startup board; sitemap + JSON-LD via the shared factory
  devbg,          // BG tech-only board; sitemap + JSON-LD
  optius,         // SI board; sitemap + JSON-LD
  posaohr,        // HR category RSS; the employer is labelled in the item
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
          workModeBy: existing.workModeBy,
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

export interface IngestReport {
  fetched: number;
  scored: number;
  stored: number;
  updated: number;
  duplicates: number;
  fitAnalyzed: number;
  perSource: Record<string, number>;
  // Sources that were still failing when the run gave up on them, retry
  // included. The sweep reads this to tell "the network died mid-slice" from
  // "a few boards are gone"; error LINES cannot answer that, because only the
  // first handful of them are kept.
  sourceFailures: number;
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
  validation?: ValidationReport;
  liveness?: LivenessReport;
  // The operator's gauge (see queue/capacity.ts): read at the end of the run,
  // printed with the report — the pressure and its dial in the same breath.
  queues?: QueueGauge[];
  // Present only on the ~monthly runs where an unscanned archive index existed.
  recrawl?: RecrawlReport;
  sponsors?: SponsorRefreshReport;
  locations?: LocResolveReport;
  errors: string[];
  harvest?: HarvestReport;
}

export interface IngestOptions {
  // Full-pool board sweep mode: ONLY discovered boards (no curated feeds, no
  // aggregators, no sponsor refresh, no harvest/probes/liveness, no LLM
  // layers). Run in slices so job batches never pile up in memory; the
  // stalest-first rotation advances the pool one slice per call.
  boardsOnly?: boolean;
  boardLimit?: number;
  // Run only these sources — see selectSources, which owns what a name means.
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
    sourceFailures: 0,
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

  // A targeted run ignores the DUE CHECK, because the selection below is what
  // narrows the pool and a sweep that just stamped the platform would
  // otherwise leave `--only recruitee` with nothing to repair. It does not
  // ignore the limit: boards arrive stalest-first and every fetch stamps, so
  // successive runs walk the platform instead of one run trying to hold it.
  // `--boards N` is how a caller asks for a bigger bite.
  const targeted = wantsAnything(opts.only);
  const discovered =
    (await stage("boardSources", report.errors, () =>
      boardSources(opts.boardLimit, {
        all: targeted,
        // Asked before the slice is counted, so the slice comes out of the
        // platform the caller named rather than out of the pool.
        wanted: targeted ? (name) => selects(name, opts.only) : undefined,
      }))) ?? [];
  const sources = selectSources(
    opts.boardsOnly ? discovered : [...companySources(), ...discovered, ...aggregators],
    opts.only,
  );

  // Visa-sponsor registers: refresh when older than two weeks.
  if (!lean) {
    report.sponsors = await stage("sponsors", report.errors, async () =>
      (await sponsorsStale()) ? refreshSponsors() : undefined);
  }

  const all: RawJob[] = [];
  const sourceStates = new Map(
    (await prisma.sourceState.findMany()).map((s) => [s.name, s.lastFetchedAt]),
  );

  // Which sources threw. A set, not a re-reading of the error list: the retry
  // pass used to ask `report.errors.some(e => e.startsWith(name + ":"))`,
  // which made a prose list load-bearing and could not tell a source that
  // failed from one that merely returned nothing. Both facts are now data.
  const failedSources = new Set<string>();

  await pass("fetch", report.errors, async (fetching) => {
    // sink: where this source's jobs land. The parallel normal-ingest path
    // passes a per-source bucket so results can be reassembled in PRIORITY
    // order after concurrent fetching — dedupe order is about assembly, not
    // fetch timing.
    const fetchOne = async (src: Source, sink: RawJob[]): Promise<void> => {
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
        failedSources.delete(src.name);
        sink.push(...jobs);
        // Adaptive frequency: tell the board how it did, so no-hit boards get
        // fetched less often over time.
        //
        // Scored on the posting AS READ, not as it arrived. The copy that was
        // here scored the raw payload — before the named blocks are assembled
        // — and lever, personio, comeet and oracle all publish their bodies as
        // blocks, so four platforms' boards were judged on a fallback text,
        // under-counted their hits, and had their interval stretched for
        // matching. `rejectedBy(scoreJob(...))` is the gate's one spelling;
        // running the whole of intake here would repeat the store loop's two
        // hashes and four guards for an answer that is measurably identical
        // (930ms per 45k-posting slice, same count).
        if (src.name.startsWith("board:")) {
          const passed = jobs.filter(
            (j) => rejectedBy(scoreJob({ ...j, description: readable(j).description })) === null,
          ).length;
          await recordBoardOutcome(src.name, jobs.length, passed, { targeted }).catch(() => {});
        }
      } catch (e) {
        report.perSource[src.name] = 0;
        failedSources.add(src.name);
        fetching.failed(e, src.name);
        // A failed board still counts as ATTEMPTED: stamp + back off, or the
        // stalest-first rotation re-selects the same failing cluster forever.
        if (src.name.startsWith("board:")) {
          const key = parseBoardSourceName(src.name);
          if (key) {
            await prisma.atsBoard.updateMany({
              where: { platform: key.platform, token: key.token, region: key.region },
              data: { lastFetchedAt: new Date() },
            }).catch(() => {});
            await recordBoardOutcome(src.name, 0, 0, { targeted }).catch(() => {});
          }
        }
      }
    };

    if (opts.boardsOnly) {
      // Sweep mode: boards are independent companies, so ordering carries no
      // dedupe priority. Nothing has to be reassembled, so every board fetches
      // straight into the shared list — a sweep slice is the RAM-sensitive path
      // and there is no reason to hold its jobs twice. Shuffled, because the
      // discovered pool arrives in platform blocks.
      await pump(sources, (src) => fetchOne(src, all), {
        concurrency: Math.min(Number(process.env.SWEEP_CONCURRENCY) || 8, 16),
        perHost: PER_HOST,
        shuffle: true,
      });
    } else {
      // Normal ingest: PARALLEL fetch, sequential priority. Source order only
      // matters at dedupe time, so each source fetches into its own bucket and
      // the buckets are concatenated in the original priority order afterwards —
      // same dedupe outcome, wall time ~= slowest source instead of the sum.
      const buckets: RawJob[][] = sources.map(() => []);
      await pump(sources, (src, i) => fetchOne(src, buckets[i]), {
        concurrency: Math.min(Number(process.env.INGEST_CONCURRENCY) || 6, 12),
        perHost: PER_HOST,
      });
      // One retry pass for sources that failed (timeouts included): transient
      // hiccups get a second chance in the same run; a second failure stays in
      // the report for investigation.
      for (let i = 0; i < sources.length; i++) {
        if (failedSources.has(sources[i].name)) await fetchOne(sources[i], buckets[i]);
      }
      // Priority-ordered assembly — this is where "source order wins dedupe"
      // actually happens.
      for (const b of buckets) all.push(...b);
    }
  });
  report.fetched = all.length;
  // Sources still failed after their retry. Counted from the set rather than
  // from how many lines the error list happens to hold: the sweep decides
  // "the network died mid-slice" from this number, and error lines are capped
  // once a handful have been shown.
  report.sourceFailures = failedSources.size;

  // Track content keys seen within this run so the same role from two sources
  // doesn't get stored twice.
  const seenContent = new Set<string>();

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

  await pass("store", report.errors, async (storing) => {
    for (const job of all) {
      // What this run makes of the sighting: the posting as it should be read,
      // the guards, the gate. Pure — everything below owns the I/O, and works
      // from `r.posting` rather than from the payload as it arrived.
      const r = intake(job, seenContent);
      const posting = r.posting;
      if (r.unconverted) report.unconverted++;
      if (r.why === "junk") { report.junkDomain++; continue; }
      if (r.why === "tooOld") { report.tooOld++; continue; }
      // Store-all: a gated posting is STORED with disqualified=true, counted
      // under the gate that turned it away so the false-negative audit has a
      // census to read.
      if (r.gate) report.eliminated[r.gate] = (report.eliminated[r.gate] ?? 0) + 1;
      else report.scored++;
      // The same role, already taken this run from a higher-priority source.
      if (r.why === "duplicate") { report.duplicates++; continue; }

      const country = resolveWithCache(posting.location, locationCache);
      // Company-level signal from the public sponsor registers (nl/gb/dk/ie).
      const sponsorReg = await isRegisteredSponsor(posting.company, country);

      const data = {
        // Identity, and our own observation of it. Everything else on the row is
        // either what the source states (statedFields) or what its text makes
        // true (derivedFields), and neither of those belongs in a literal here.
        dedupeKey: r.key,
        contentKey: r.ck,
        source: posting.source,
        externalId: posting.externalId,
        country,
        ...statedFields(posting),
        ...derivedFields(posting, { country, sponsorReg }),
        postedAt: posting.postedAt ?? null,
      };

      if (posting.location && country === null && resolveCountry(posting.location) === null) {
        const key = normalizeLocation(posting.location);
        if (!locationCache.has(key)) {
          if (!unknownLocations.has(key)) unknownLocations.set(key, new Set());
          unknownLocations.get(key)!.add(posting.location);
        }
      }

      // Per-job isolation: a single poison row (lone surrogate, whatever
      // tomorrow brings) must cost ONE job, never a 53k-board run — this is
      // the third crash class caught here, so guard the class.
      try {
        const outcome = await storeSighting(posting, { key: r.key, ck: r.ck, country, sponsorReg, identity: data });
        // The role is taken only once it is actually held. Burning the key
        // before the write meant a poison row from a high-priority source
        // ALSO refused the same role from every later one, and the run lost
        // the posting entirely rather than costing one attempt.
        seenContent.add(r.ck);
        if (outcome.kind === "updated") {
          report.updated++;
        } else {
          report.stored++;
          newlyCreated.push({ id: outcome.id, title: posting.title, company: posting.company, description: posting.description, source: posting.source });
          if (isAggregatorJob(posting) && posting.url) newlyStoredUrls.push(posting.url);
        }
      } catch (e) {
        storing.failed(e, `${posting.source}/${posting.externalId}`);
      }
    }
  });

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

  // EVERYTHING BELOW IS A STAGE, and a lean run has none of them: the board
  // sweep and a targeted --only text repair both want the fetch/store/delist
  // core and nothing else.
  if (!lean) {
    // Discovery harvest: mine ATS board candidates from the aggregator URLs.
    report.harvest = await stage("harvest", report.errors, () =>
      harvest(aggregatorUrls, { resolveUrls: newlyStoredUrls }));

    // Harvest tier 4: aggregator jobs carry no company URL, but the company
    // NAME slugifies into probeable ATS tokens. Verified hits join the board
    // pool as active — the whole company upgrades to first-party next ingest.
    report.nameProbe = await stage("name-probe", report.errors, async () => {
      // The whole pool's backlog, not just this run's arrivals: a run that
      // stores 7,869 postings can create hundreds of new companies, and the
      // old this-run-only selection meant every one the budget missed was
      // never revisited. backlogNames orders by best posting score, so a
      // bounded budget spends itself on the boards worth finding first.
      // Two backlogs feed this lane, and they are not interchangeable. The
      // POOL backlog is companies whose postings we already hold — the
      // highest-yield names we have (measured 9.3%), because every one is
      // demonstrably hiring. The REGISTER backlog is government sponsor
      // lists, where a hit is worth more per board (the company's
      // sponsorship is a matter of public record) but the rate is lower
      // (~3.8%). Seeding the registers used to be a hand-run script, so it
      // advanced only when somebody remembered; a standing slice makes it a
      // lane instead of a chore. Pool first, because rate beats provenance
      // when the budget is the scarce thing.
      const registerSlice = Math.min(REGISTER_PROBE_SLICE, NAME_PROBE_MAX);
      const pool = await backlogNames(NAME_PROBE_MAX - registerSlice);
      const registers = await registerNames(registerSlice + (NAME_PROBE_MAX - registerSlice - pool.length));
      const names = [...pool, ...registers];
      return names.length > 0 ? runNameProbes(names, NAME_PROBE_MAX) : undefined;
    });

    // Harvest tier 5: rescue lane for name-probe misses — LLM resolves the
    // company website, the careers page reveals the ATS, probe verifies.
    if (llmEnabled()) {
      report.deepProbe = await stage("deep-probe", report.errors, () => runDeepProbes(DEEP_PROBE_MAX));
    }

    // Board validation: discovery finds CANDIDATES, and only ACTIVE boards are
    // ever fetched (boardSources filters on status). Until now nothing in the
    // ingest closed that gap — runValidation existed only as a hand-run
    // script, so 12,160 discovered boards sat as candidates indefinitely,
    // including 1,783 enterprise Oracle/Cornerstone/Eightfold tenants the
    // archive lane had already found and nobody had ever probed (#6 assumed
    // crawl had not reached them; crawl had, validation had not).
    //
    // Workday's own history sets the expectation: 7,329 validated, 3,940
    // active — 54% of candidates turn out alive. The lane is cheap (one HTTP
    // probe per board, ten at a time) and monotonic: a validated board leaves
    // the queue for RECHECK_DAYS, so a bounded budget drains the backlog
    // rather than re-walking its head. The one exception is a board whose
    // probe ERRORS, which is deliberately left untouched to be retried — if
    // a block of those ever accumulates it will show as a rising `errors`
    // count in this stage's report rather than as silent starvation.
    report.validation = await stage("validate", report.errors, () =>
      runValidation({ limit: VALIDATE_MAX }));

    // Liveness probing: aggregator jobs have no diffable feed, so aging ones
    // get their URLs probed for closure banners.
    report.liveness = await stage("liveness", report.errors, () => runLivenessSweep());

    // The recurring archive scan (#15): about once a month this finds a
    // Common Crawl index nobody has scanned and spends 10-20 minutes on it
    // (plus an incremental Wayback cut); every other day it costs one row
    // read and usually no network at all. Self-scheduling on purpose — the
    // product's rhythm has exactly one timer, the daily ingest, and a missed
    // month heals because the question is asked of the archives, not of a
    // calendar.
    report.recrawl = await stage("recrawl", report.errors, () =>
      recrawlIfDue(new Date(), (m) => console.log("  " + m)).then((r) => r ?? undefined));

    // Batched LLM location resolution for strings the gazetteer+cache missed.
    if (llmEnabled() && unknownLocations.size > 0) {
      report.locations = await stage("locations", report.errors, () =>
        resolveUnknownLocations(unknownLocations));
    }

    // Semantic dedup: is a newly stored job the same OPPORTUNITY as one we
    // already track from the same company (repost / reworded / per-city)?
    // Cheap funnel: no same-company rows → no LLM call at all; a titles-only
    // fast-tier pass gates the expensive full comparison. Budgeted per ingest.
    if (llmEnabled() && newlyCreated.length > 0) {
      await stage("dedup", report.errors, async (p) => {
        let compareBudget = DEDUP_MAX_COMPARES;
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
          } catch (e) {
            // A token budget that ran out is not a bad row: it ends the stage,
            // and everything found so far stays in the report.
            p.failed(e, nj.id);
          }
        }
      });
    }

    // Auto-analyze the top-keyword jobs with the LLM (CV vs job description) so
    // the dashboard can rank by real fit, not just keyword score.
    if (llmEnabled()) {
      await stage("fit", report.errors, async (p) => {
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
          } catch (e) {
            // Out of daily tokens — the stage ends, everything else is kept.
            // The remaining jobs stay fitScore:null for the next ingest.
            p.failed(e, j.id);
          }
        }
      });
    }
  }

  // The stat strip reads this one row instead of group-by'ing half a million,
  // so it is exactly as fresh as the last run that wrote it — and that used to
  // mean "the last run that was not lean", because the early return that
  // skipped the stages sat above this too. A hundred-slice sweep could store
  // thousands of postings over a day while the strip showed the pool as it was
  // before it started. Every run that changed the pool closes by re-reading it;
  // a run that changed nothing has nothing to say.
  //
  // "Changed the pool" has to mean the three things this row actually holds —
  // a total, a status census and a VERDICT census. The fit stage writes
  // verdicts on postings this run never fetched, so an ingest whose sources
  // were all down could still change the strip and then decline to refresh it.
  report.queues = await stage("queue-gauges", report.errors, () => readQueueGauges());

  if (report.stored + report.updated + report.delisted + report.fitAnalyzed > 0) {
    await stage("snapshot", report.errors, async () => {
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
    });
  }

  return report;
}
