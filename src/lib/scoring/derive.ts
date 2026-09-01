// WHAT A POSTING'S TEXT MAKES TRUE, in one place.
//
// A census of every write to a Job row found the derived fields listed out by
// hand in four places — ingest's create path, ingest's update path, desc-fill
// and rescore — and the four lists had already drifted apart in six ways:
//
//   * ingest applied `disqualified || score < STORE_THRESHOLD`; desc-fill and
//     rescore applied only the first half, so a re-scored posting could sit
//     live below the gate that an identical new one is rejected by.
//   * desc-fill lacked the "the LLM's seniority verdict outranks the detector"
//     guard the other two have, so it demoted 2,064 postings' levels back to a
//     regex reading on every pass.
//   * desc-fill and rescore wrote `visa` raw, bypassing visaFields, so an LLM's
//     reading lost to a later regex pass and the derived tier was never
//     recomputed.
//   * rescore wrote a coerced track to the Job row and the uncoerced one to its
//     own history row, so the two disagreed for every disqualified posting.
//   * neither ingest path appended a KeywordScoreHistory row at all, which put
//     995 postings in the rescore queue that ingest had just scored with the
//     current scorer.
//   * `scoreJob`'s knownLevel hint was passed by rescore and by nobody else.
//
// Every one of those is the same bug: a field that follows the text, written by
// a caller who chose which fields to write. So the caller stops choosing. These
// functions return a spreadable record and the writers spread it whole.
//
// The pattern is visaFields', which has held: by returning {visa, visaBy,
// visaTier} as one unit it made forgetting the tier impossible, and its only
// failure mode was a caller who never called it — which is what the guard test
// in tests/derive.test.ts now catches.

import { scoreJob, SCORER_VERSION, type Scored, type ScoreGate } from "./score";
import type { RawJob } from "../sources/types";
import { detectWorkMode } from "../text/workmode";
import { detectVisa } from "../visa/visa";
import { visaFields } from "../visa/visa-write";
import { sourceTrust, canonicalJobUrl } from "../domains";
import type { SeniorityLevel } from "./seniority";

// Minimum keyword score to keep a posting out of the archive. Lives here
// because `disqualified` is a derived field and this is the number that
// derives it; it was in ingest.ts, which is why two other writers applied only
// half the gate.
export const STORE_THRESHOLD = 20;

// Every way a posting can be turned away: the scorer's five gates, plus the
// store threshold, which is not a scorer gate at all — it is this module's
// own half of the rule.
export type Gate = ScoreGate | "belowThreshold";

// WHICH GATE TURNED THIS POSTING AWAY, or null if none did.
//
// The whole gate, in one answer. `disqualified` below is defined as this
// being non-null, so the flag on the row and the name in the ingest report
// cannot disagree — and they did: ingest re-derived the same boolean and then
// recovered the gate's NAME by matching prefixes of the reason prose.
//
// Turned away is not dropped. A rejected posting is stored with
// disqualified=true, so a scorer fix is a re-score rather than a re-crawl,
// and "high embedding similarity but disqualified" doubles as a gate-mistake
// detector.
export function rejectedBy(s: Scored): Gate | null {
  return s.gate ?? (s.score < STORE_THRESHOLD ? "belowThreshold" : null);
}

// What the row already says about itself. Needed because two rules are
// provenance-aware — a weaker layer never overwrites a stronger one — and both
// were being applied in some writers and not others.
export interface CurrentRow {
  visa: string;
  visaBy: string | null;
  seniorityLevel: string | null;
  seniorityBy: string | null;
  workModeBy: string | null;
  sponsorReg: boolean;
  source: string;
  country: string | null;
}

// Facts the caller has looked up and this module cannot: both are async
// (a gazetteer/LLM lookup and a sponsor-register match) and both are cached
// per run by the caller that has the cache.
export interface DeriveContext {
  country: string | null;
  sponsorReg: boolean;
  current?: CurrentRow;
}

// The work-mode layer, spreadable like everything else a writer spreads.
// Absent keys mean "leave the row alone", which is how a stated or LLM-read
// mode survives a sighting whose text is silent.
export function workModeFields(
  job: RawJob,
  current?: Pick<CurrentRow, "workModeBy">,
): { workMode?: string; workModeBy?: string | null } {
  if (job.workMode) return { workMode: job.workMode, workModeBy: "source" };
  if (current?.workModeBy === "source") return {};
  const read = detectWorkMode(job.title, job.location, job.description);
  if (read) return { workMode: read, workModeBy: "text" };
  if (current?.workModeBy) return {}; // llm or text already answered; silence changes nothing
  return { workMode: "unknown", workModeBy: null };
}

// EVERYTHING A POSTING'S TEXT MAKES TRUE.
//
// `job.description` is the text to derive FROM — pass the text you are going to
// keep, not the text that just arrived. Those are not the same on a re-sighting
// and the difference used to undo desc-fill's work on every sweep: several
// platforms' list payloads carry only a title, so a title-only re-sighting
// re-scored an enriched posting down to a title-only score.
export function derivedFields(job: RawJob, ctx: DeriveContext) {
  const current = ctx.current;
  // The level the facts extractor read outranks the detector's guess, so feed
  // it back into the scorer rather than letting the detector re-derive a weaker
  // one — the seniority band affects the score, not just the badge. Only
  // rescore used to pass this; ingest scored 2,064 LLM-levelled postings
  // without it.
  const knownLevel =
    current?.seniorityBy === "llm" && current.seniorityLevel
      ? (current.seniorityLevel as SeniorityLevel)
      : undefined;
  const s = scoreJob(job, knownLevel ? { knownLevel } : {});

  // The whole gate, both halves. `score`, `disqualified` and the history row
  // all read from this one local, so they cannot disagree.
  const rejected = rejectedBy(s) !== null;
  const score = rejected ? 0 : s.score;
  const track = rejected ? "other" : s.track;

  // The reading this text supports, from the text we are keeping. On a
  // re-sighting it is offered as EVIDENCE and loses to anything stronger; on a
  // create there is no incumbent, so it passes straight through.
  //
  // This is where the kept-text discipline used to stop: the update path read
  // visa from the raw incoming payload, so a title-only re-sighting offered
  // "unknown" and — because same-strength evidence wins — overwrote what the
  // enriched body had said. Measured small (4 postings today) only because
  // desc-fill's own raw write happened to repair it.
  const reading = { visa: job.visa ?? detectVisa(job.description, job.title), by: (job.visa ? "source" : "regex") as "source" | "regex" };
  const visa = visaFields(
    {
      visa: current?.visa ?? reading.visa,
      visaBy: current?.visaBy ?? reading.by,
      sponsorReg: ctx.sponsorReg,
      source: current?.source ?? job.source,
      country: ctx.country,
    },
    current ? reading : undefined,
  );

  return {
    score,
    track,
    scoreReason: s.reason,
    scoredBy: s.scoredBy,
    disqualified: rejected,
    langReq: s.langReq || null,
    // WHERE THE WORK HAPPENS — a claim with an author, layered by strength:
    // the employer's structural field, then the position-first text detector,
    // then (written elsewhere, by applyFactsToJob) the LLM, then unknown. A
    // weaker author never overwrites a stronger one across re-sightings, and
    // the detector re-reading the text MAY overwrite the LLM: it is measured
    // at ~95% where it speaks, and the LLM only ever had the same text.
    //
    // This replaced deriveWorkMode, whose whole-description "hybrid" scan was
    // measured at 46% against 599 employer-stated Lever postings — worse than
    // it sounds, because its onsite default meant it was WRONG loudly: 45k
    // postings wore a guess as a finding.
    ...workModeFields(job, current),
    ...visa,
    sponsorReg: ctx.sponsorReg,
    // The LLM's level verdict outranks the detector — don't overwrite it.
    ...(current?.seniorityBy === "llm"
      ? {}
      : {
          seniorityLevel: s.seniorityLevel === "unknown" ? null : s.seniorityLevel,
          seniorityBy: s.seniorityLevel === "unknown" ? null : "detector",
        }),
    // The history row rides along, so writing the projection cannot happen
    // without recording the decision that produced it. It carries the SAME
    // coerced values as the row above — rescore's copy did not, and disagreed
    // with its own Job row on `track` for every disqualified posting.
    scores: {
      create: {
        scorerVersion: SCORER_VERSION,
        score,
        track,
        reason: s.reason,
        disqualified: rejected,
        at: new Date(),
      },
    },
  };
}

// WHAT THE SOURCE SAYS ABOUT ITS OWN POSTING.
//
// Separate from derivedFields because the two go stale for different reasons:
// derived fields age when OUR code changes (which is what the version stamps
// are for), stated fields age when the SOURCE changes. Collapsing them would
// hide which of the two happened.
//
// The update path used to refresh none of these, so a retitled or relocated
// posting kept its first sighting forever and nothing could reveal it.
//
// Three deliberate exclusions:
//   * postedAt — the freshness reading rests on it, and a source that
//     re-stamps an evergreen ad as "posted today" would launder a dead posting
//     into a fresh one. The pool clock exists because source dates lie.
//   * dedupeKey / source / externalId — identity, not description. A row
//     matched by contentKey was found under a DIFFERENT source, and rewriting
//     these would hand it to a different board's feed-diff sweep, which
//     delists by (source, externalId).
//   * country / sponsorReg — derived from a lookup, not stated; they ride with
//     derivedFields, which already has them.
export function statedFields(job: RawJob) {
  return {
    title: job.title,
    company: job.company,
    location: job.location ?? null,
    remote: job.remote,
    salaryText: job.salaryText ?? null,
    url: canonicalJobUrl(job.url), // tracking params stripped, stable form
    sourceTrust: sourceTrust(job.source),
  };
}
