import { prisma } from "../db";
import { profile } from "../user/profile";
import { deriveVisaTier, visaEvidenceWins, type VisaSignal } from "./visa";
import type { PostingFactsResult } from "../llm/facts";

// THE single writer for visa evidence and the derived tier.
//
// visaTier is a stored derived column (the radar filters and the fit queue
// sort on it over half a million rows, so it must be indexable). A stored
// derivation is only safe if it cannot be forgotten: every path that touches
// visa evidence goes through here, and `npm run doctor` audits the invariant
// across the pool. Nothing else may write visaTier.

export interface VisaEvidence {
  visa: VisaSignal;
  by: "regex" | "source" | "llm";
}

// Compute the fields a Job row should carry, given (possibly new) evidence.
// Weaker evidence never overwrites stronger: an LLM reading survives a later
// regex pass over a re-fetched description.
export function visaFields(current: {
  visa: string;
  visaBy: string | null;
  sponsorReg: boolean;
  source: string;
  country: string | null;
}, incoming?: VisaEvidence): { visa: string; visaBy: string | null; visaTier: string } {
  const takeIncoming = incoming !== undefined && visaEvidenceWins(current.visaBy, incoming.by);
  const visa = takeIncoming ? incoming!.visa : current.visa;
  const visaBy = takeIncoming ? incoming!.by : current.visaBy;
  const visaTier = deriveVisaTier(
    { visa, sponsorReg: current.sponsorReg, source: current.source, country: current.country },
    profile.workAuthorization,
  );
  return { visa, visaBy, visaTier };
}

// Persist extracted posting facts (the CV-independent stage) onto a job:
// the facts row itself, plus the projections the radar and the queue read.
// Measured 2026-09-01 and FAILED: 68.3% where it speaks, on the slice where
// the text detector is silent — the only place it would ever write (bar: 90%,
// scripts/measure/workmode-llm.ts, 150 employer-labelled postings). The
// failure mode is inference from a bare city location to "onsite" — 74 onsite
// answers of which 29 were stated hybrid or remote — despite the prompt's
// never-infer instruction. The same disease the old regex default had, worn
// by a model. The answer keeps being RECORDED on PostingFacts, so a better
// prompt can be re-measured against it without re-running the queue; this
// stays false until a measurement clears the bar.
const APPLY_LLM_WORKMODE = false;

export async function applyFactsToJob(jobId: string, facts: PostingFactsResult): Promise<void> {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: { visa: true, visaBy: true, sponsorReg: true, source: true, country: true, workModeBy: true },
  });
  if (!job) return;
  const evidence: VisaEvidence | undefined =
    facts.visaOffered === "yes" ? { visa: "yes", by: "llm" }
    : facts.visaOffered === "no" ? { visa: "no", by: "llm" }
    : undefined;
  const v = visaFields(job, evidence);
  await prisma.job.update({
    where: { id: jobId },
    data: {
      ...v,
      langReq: facts.langReq || null,
      ...(facts.seniorityLevel && facts.seniorityLevel !== "unknown"
        ? { seniorityLevel: facts.seniorityLevel, seniorityBy: "llm" }
        : {}),
      ghostRisk: facts.ghostRisk,
      // The weakest author in the work-mode layer: it writes only where the
      // employer's field and the measured text detector were both silent, and
      // only having passed the same bar they did — scripts/measure/workmode-llm
      // scores the extractor against employer-stated ground truth, and until
      // that run clears 90% where it speaks, the answer is RECORDED on the
      // facts row below but not projected onto the posting. Flip APPLY_WORKMODE
      // when the measurement says so.
      ...(APPLY_LLM_WORKMODE && facts.workMode && !job.workModeBy
        ? { workMode: facts.workMode, workModeBy: "llm" }
        : {}),
      facts: {
        upsert: {
          create: {
            visaOffered: facts.visaOffered, seniorityLevel: facts.seniorityLevel,
            workMode: facts.workMode,
            langReq: facts.langReq || null, ghostRisk: facts.ghostRisk,
            model: process.env.OLLAMA_MODEL ?? "unknown",
            extractorVersion: (await import("../llm/facts")).EXTRACTOR_VERSION,
            at: new Date(),
          },
          update: {
            visaOffered: facts.visaOffered, seniorityLevel: facts.seniorityLevel,
            workMode: facts.workMode,
            langReq: facts.langReq || null, ghostRisk: facts.ghostRisk,
            model: process.env.OLLAMA_MODEL ?? "unknown",
            extractorVersion: (await import("../llm/facts")).EXTRACTOR_VERSION,
            at: new Date(),
          },
        },
      },
    },
  });
}
