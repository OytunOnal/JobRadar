import { prisma } from "./db";
import { profile } from "./profile";
import { deriveVisaTier, visaEvidenceWins, type VisaSignal } from "./visa";
import type { PostingFactsResult } from "./facts";

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
export async function applyFactsToJob(jobId: string, facts: PostingFactsResult): Promise<void> {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: { visa: true, visaBy: true, sponsorReg: true, source: true, country: true },
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
      facts: {
        upsert: {
          create: {
            visaOffered: facts.visaOffered, seniorityLevel: facts.seniorityLevel,
            langReq: facts.langReq || null, ghostRisk: facts.ghostRisk,
            model: process.env.OLLAMA_MODEL ?? "unknown",
            extractorVersion: (await import("./facts")).EXTRACTOR_VERSION,
            at: new Date(),
          },
          update: {
            visaOffered: facts.visaOffered, seniorityLevel: facts.seniorityLevel,
            langReq: facts.langReq || null, ghostRisk: facts.ghostRisk,
            model: process.env.OLLAMA_MODEL ?? "unknown",
            extractorVersion: (await import("./facts")).EXTRACTOR_VERSION,
            at: new Date(),
          },
        },
      },
    },
  });
}
