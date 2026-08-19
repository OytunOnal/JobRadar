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
import { companySources } from "./sources/companies";
import { analyzeFit } from "./fit";
import { llmEnabled, RateLimitError } from "./llm";
import { harvest, type HarvestReport } from "./discovery/harvest";
import { boardSources, recordBoardOutcome } from "./discovery/boardSources";
import { tooOldToStore } from "./freshness";
import { isJunkJobUrl, sourceTrust } from "./domains";
import type { RawJob, Source } from "./sources/types";

// How many top-keyword-scored jobs to auto-analyze with the LLM per ingest.
// Bounded to keep token cost + rate-limit pressure predictable.
const AUTO_FIT_TOP_N = 25;

const aggregators: Source[] = [
  arbeitnow,
  remotive,
  remoteok,
  jobicy,
  himalayas,
  weworkremotely,
  adzuna,   // needs ADZUNA_APP_ID + ADZUNA_APP_KEY; skips itself otherwise
  jsearch,  // needs RAPIDAPI_KEY; skips itself otherwise
];


// Minimum keyword score to bother storing. Junk (score 0, disqualified) is dropped.
const STORE_THRESHOLD = 20;

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
  errors: string[];
  harvest?: HarvestReport;
}

// Aggregator jobs carry foreign URLs worth harvesting for ATS identities;
// ATS-sourced jobs (source "gh:x", "lever:x", ...) already reveal theirs.
function isAggregatorJob(job: RawJob): boolean {
  return !job.source.includes(":");
}

export async function runIngest(): Promise<IngestReport> {
  const report: IngestReport = {
    fetched: 0,
    scored: 0,
    stored: 0,
    updated: 0,
    duplicates: 0,
    fitAnalyzed: 0,
    perSource: {},
    tooOld: 0,
    junkDomain: 0,
    errors: [],
  };

  // Source order decides who wins dedupe: curated ATS feeds first, then
  // discovered boards (also direct-apply), aggregators last — so when the same
  // role arrives from several places, the official ATS listing is the one kept.
  let discovered: Source[] = [];
  try {
    discovered = await boardSources();
  } catch (e: any) {
    report.errors.push(`boardSources: ${e.message}`);
  }
  const sources: Source[] = [...companySources(), ...discovered, ...aggregators];

  const all: RawJob[] = [];
  for (const src of sources) {
    try {
      const jobs = await src.fetch();
      report.perSource[src.name] = jobs.length;
      all.push(...jobs);
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
    }
  }
  report.fetched = all.length;

  // Track content keys seen within this run so the same role from two sources
  // doesn't get stored twice.
  const seenContent = new Set<string>();

  // Harvest inputs: every aggregator URL gets a free tier-1 scan (junk and
  // disqualified jobs included — their URLs still reveal ATS identities);
  // network resolves are spent only on this run's newly-stored jobs.
  const aggregatorUrls: string[] = [];
  const newlyStoredUrls: string[] = [];
  for (const job of all) {
    if (isAggregatorJob(job) && job.url) aggregatorUrls.push(job.url);
  }

  for (const job of all) {
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
    if (s.disqualified || s.score < STORE_THRESHOLD) continue;
    report.scored++;

    const key = dedupeKey(job);
    const ck = contentKey(job);

    // Same role already handled this run (from an earlier, higher-priority source).
    if (seenContent.has(ck)) {
      report.duplicates++;
      continue;
    }
    seenContent.add(ck);

    const data = {
      dedupeKey: key,
      contentKey: ck,
      source: job.source,
      externalId: job.externalId,
      url: job.url,
      title: job.title,
      company: job.company,
      location: job.location ?? null,
      remote: job.remote,
      salaryText: job.salaryText ?? null,
      sourceTrust: sourceTrust(job.source),
      description: job.description.slice(0, 8000),
      score: s.score,
      track: s.track,
      scoreReason: s.reason,
      scoredBy: s.scoredBy,
      postedAt: job.postedAt ?? null,
    };

    // Exact same-source match, or the same role stored under a different source.
    const existing =
      (await prisma.job.findUnique({ where: { dedupeKey: key } })) ??
      (await prisma.job.findFirst({ where: { contentKey: ck } }));

    if (existing) {
      // Refresh score/text but never clobber the user's pipeline status/notes.
      await prisma.job.update({
        where: { id: existing.id },
        data: {
          score: data.score,
          track: data.track,
          scoreReason: data.scoreReason,
          scoredBy: data.scoredBy,
          salaryText: data.salaryText,
          contentKey: ck,
          // Pool-diff freshness: the job is still listed at its source.
          lastSeenAt: new Date(),
        },
      });
      report.updated++;
    } else {
      await prisma.job.create({ data });
      report.stored++;
      if (isAggregatorJob(job) && job.url) newlyStoredUrls.push(job.url);
    }
  }

  // Discovery harvest: mine ATS board candidates from the aggregator URLs.
  // Isolated so no harvest failure can sink the ingest.
  try {
    report.harvest = await harvest(aggregatorUrls, { resolveUrls: newlyStoredUrls });
  } catch (e: any) {
    report.errors.push(`harvest: ${e.message}`);
  }

  // Auto-analyze the top-keyword jobs with the LLM (CV vs job description) so the
  // dashboard can rank by real fit, not just keyword score. No-ops without a key.
  if (llmEnabled()) {
    const toAnalyze = await prisma.job.findMany({
      where: { fitScore: null, status: { in: ["new", "interested"] } },
      orderBy: { score: "desc" },
      take: AUTO_FIT_TOP_N,
    });
    for (const j of toAnalyze) {
      try {
        const fit = await analyzeFit(j);
        if (!fit) continue;
        await prisma.job.update({
          where: { id: j.id },
          data: { fitScore: fit.fitScore, fitVerdict: fit.verdict, fitComment: fit.comment, fitCategory: fit.category, ghostRisk: fit.ghostRisk },
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

  return report;
}
