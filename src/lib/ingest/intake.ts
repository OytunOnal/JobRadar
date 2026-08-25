import { createHash } from "node:crypto";
import { scoreJob } from "../scoring/score";
import { rejectedBy, type Gate } from "../scoring/derive";
import { tooOldToStore } from "../scoring/freshness";
import { isJunkJobUrl } from "../domains";
import { htmlToText, looksLikeHtml } from "../text/html-text";
import { labelledSections } from "../text/sections";
import type { RawJob } from "../sources/types";

// WHAT AN INGEST MAKES OF ONE SIGHTING, before anything is written.
//
// Four guards, one scoring, two identity keys — ten decisions per posting,
// none of them callable. They sat inside a 126-line loop inside a 544-line
// function with ~140 network sources between a test and the decision, so the
// only thing that could exercise them was a full ingest. Everything here is
// pure: no database, no caches, no clock beyond the posting's own dates.
//
// What deliberately stays in the caller is the I/O — resolving a location
// against the run's cache, asking the sponsor registers about a company,
// writing the row. Those need the run; this needs only the sighting.
//
// TURNED AWAY IS NOT THE SAME AS NOT STORED. A posting the score gates reject
// is still stored, flagged, so a scorer fix is a re-score rather than a
// re-crawl (ADR-1). The three refusals below are the ones that never become a
// posting at all: an SEO farm's copy, an aggregator's repost of something long
// dead, and a role this same run already took from a higher-priority source.

export type Refusal = "junk" | "tooOld" | "duplicate";

interface Sighting {
  /**
   * The text this posting should be read as, and the text every derived value
   * must be derived from: named blocks assembled, markup converted.
   */
  description: string;
  /**
   * The connector handed us markup. A connector reaching here is a connector
   * bug, so it is repaired AND counted — a silent repair would hide it.
   * Measured when the conversion landed: 1 posting in 3,577.
   */
  unconverted: boolean;
  /**
   * The date the source claims, or null when it parsed to nonsense. Sources
   * read dates out of wild formats and one NaN Date took down a sweep slice;
   * degrading to "date unknown" is always available and never fatal.
   */
  postedAt: Date | null;
}

// What is known once a sighting has been scored: which gate turned it away
// (null = none did), and the two identities it answers to.
interface Scored {
  gate: Gate | null;
  key: string;
  ck: string;
}

// One arm per refusal rather than one arm for the two pre-scoring ones: the
// caller checks them one at a time, and a `why: "junk" | "tooOld"` arm cannot
// be narrowed away by a single equality test — which is how the compiler
// enforces that nothing reads a gate off a sighting that was never scored.
export type Intake =
  | (Sighting & { store: false; why: "junk" })
  | (Sighting & { store: false; why: "tooOld" })
  // Scored — so it counts towards the report's gate census — but this run has
  // already handled the same role from an earlier, higher-priority source.
  | (Sighting & Scored & { store: false; why: "duplicate" })
  | (Sighting & Scored & { store: true; why: null });

// Aggregator jobs carry foreign URLs worth harvesting for ATS identities;
// ATS-sourced jobs (source "gh:x", "lever:x", ...) already reveal theirs.
export function isAggregatorJob(job: RawJob): boolean {
  return !job.source.includes(":");
}

// This exact posting, as this exact source published it.
export function dedupeKey(job: RawJob): string {
  return createHash("sha1").update(`${job.source}:${job.externalId}`).digest("hex");
}

// This ROLE, whoever published it: normalize a title/company so the same job
// from different sources collapses — drop parentheticals ("(Remote)",
// "(m/f/d)"), punctuation, and extra spaces.
function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function contentKey(job: RawJob): string {
  return createHash("sha1").update(`${norm(job.title)}|${norm(job.company)}`).digest("hex");
}

// The description this sighting should be read as.
//
// A source that splits its body into named blocks told us so; assembling those
// blocks into one text is OUR decision, and it moves whenever the section
// parser does — eight adapters used to make it themselves. The adapter's own
// `description` stays as the fallback for when every block came back empty:
// Lever's structure-destroyed descriptionPlain, Personio's unpaired <value>
// blocks, a bare title.
//
// The markup conversion is A LAST LINE, NOT A CONVERSION STEP. Converting
// unconditionally would be wrong: several connectors SYNTHESIZE plain text
// (SwissDevJobs' "Technologies: ..." line, a16z's "title · function ·
// seniority"), and htmlToText treats `<` followed by a letter as a tag, so a
// stack listing `<T>` or `<canvas>` would lose those tokens. (Measured: the
// surrounding words survive, because the match stops at the first `>`. Prose
// like "latency < 100ms" is safe either way — the regex requires a letter.)
// looksLikeHtml is narrow enough to tell the two apart, firing only on real
// tag names and a handful of entities.
//
// It matters more than the count suggests: betterText judges quality by the
// presence of newlines, raw markup has plenty, so unconverted markup can WIN
// against clean text on a re-sighting — and TEXT_VERSION is stamped either
// way, so the repair queue sees it as current.
function readable(job: RawJob): { description: string; unconverted: boolean } {
  let description = job.description;
  if (job.sections?.length) {
    const assembled = labelledSections(job.sections);
    if (assembled) description = assembled;
  }
  if (looksLikeHtml(description)) {
    return { description: htmlToText(description), unconverted: true };
  }
  return { description, unconverted: false };
}

/**
 * Read one sighting. `seen` is the set of content keys this run has already
 * taken — read, never written: adding the key is the caller's, because only
 * the caller knows whether the store that follows succeeded.
 */
export function intake(job: RawJob, seen: ReadonlySet<string>): Intake {
  const { description, unconverted } = readable(job);
  const postedAt =
    job.postedAt && !Number.isNaN(job.postedAt.getTime()) ? job.postedAt : null;
  const sighting = { description, unconverted, postedAt };

  // SEO-farm copies: the original arrives via a better source.
  if (isJunkJobUrl(job.url)) return { ...sighting, store: false, why: "junk" };
  // Aggregator reposts of long-dead listings are noise — refused before
  // anything is spent on them. Their URL was still harvested.
  if (tooOldToStore(postedAt, isAggregatorJob(job))) {
    return { ...sighting, store: false, why: "tooOld" };
  }

  // Score the text we are going to KEEP, which is why this happens after the
  // assembly above and not on the payload as it arrived.
  const gate = rejectedBy(scoreJob({ ...job, description }));
  const key = dedupeKey(job);
  const ck = contentKey(job);

  return seen.has(ck)
    ? { ...sighting, store: false, why: "duplicate", gate, key, ck }
    : { ...sighting, store: true, why: null, gate, key, ck };
}
