// Visa sponsorship signal, derived free at ingest from the posting text.
// Three values: "yes" (sponsorship/relocation offered), "no" (explicitly
// ruled out or right-to-work required), "unknown" (posting doesn't say —
// the honest majority). The LLM fit pass upgrades unknown→no when it reads
// an explicit refusal (fitCategory NO_VISA).
//
// Negatives are checked FIRST: "visa sponsorship is not available" must not
// match the positive "visa sponsorship" pattern.

export type VisaSignal = "yes" | "no" | "unknown";

// "Marked as sponsoring" — the signals we have WITHOUT asking a model: the
// company sits in a public sponsor register, the source shipped a structured
// visa flag, or the posting itself says so. These are the user's stated
// priority, and unlike the LLM's reading they are known before any GPU time
// is spent.
//
// It lives here rather than in fit.ts because it is a fact about a posting's
// visa evidence, not a judging policy — the worker uses it to pick a lane and
// the embedding queue uses it to order one, neither of which is judging.
export const VISA_MARKED = {
  OR: [{ visaTier: "yes" }, { visaTier: "not-needed" }, { sponsorReg: true }, { visa: "yes" }],
};

const NEGATIVE_RE = new RegExp(
  [
    "no visa sponsorship",
    "visa sponsorship (?:is )?not (?:available|provided|offered|possible)",
    "(?:unable|not able) to (?:provide|offer|support) (?:visa )?sponsorship",
    "cannot (?:provide|offer|support) (?:visa )?sponsorship",
    "we (?:do|can) ?not (?:currently )?(?:offer|provide|sponsor)[^.]{0,30}visa",
    "without (?:visa )?sponsorship",
    "no (?:work permit|visa) (?:support|sponsorship)",
    "must (?:already )?(?:have|hold|possess) (?:the )?(?:legal )?right to work",
    "right to work in [^.]{0,30}(?:is )?required",
    "(?:authorized|authorised|eligible) to work[^.]{0,40}(?:required|without sponsorship)",
    "valid work (?:permit|authori[sz]ation) (?:is )?required",
  ].join("|"),
  "i",
);

const POSITIVE_RE = new RegExp(
  [
    "visa sponsorship(?: is)? (?:available|provided|offered|possible)",
    "we (?:can |do |will |also )?(?:offer|provide|sponsor)[^.]{0,30}visa",
    "visa (?:and|&) relocation",
    "relocation (?:and|&) visa",
    "relocation (?:package|support|assistance|budget|bonus)",
    "we support (?:your )?relocation",
    "work permit (?:support|assistance|sponsorship)",
    "visa (?:support|assistance)",
    "sponsorship (?:is )?(?:available|provided|offered)",
  ].join("|"),
  "i",
);

export function detectVisa(description: string, title = ""): VisaSignal {
  const text = `${title}\n${description}`;
  if (NEGATIVE_RE.test(text)) return "no";
  if (POSITIVE_RE.test(text)) return "yes";
  return "unknown";
}

// ── Visa tier: the derived answer the UI and the fit queue actually use ──────
// Evidence (what the POSTING says) and capability (what the COMPANY may do)
// are different facts and they DO contradict — 51 live rows sit in a public
// sponsor register while their posting explicitly refuses sponsorship. So the
// tier is derived, never stored by hand:
//
//   not-needed  the user already has the right to work in this job's country
//   yes         the posting (or the source's structured flag) offers sponsorship
//   maybe       posting silent, but the company is register-listed OR the whole
//               source only lists licensed sponsors
//   no          the posting explicitly refuses / demands an existing permit
//   unknown     nothing is known
//
// Whether sponsorship is needed AT ALL is a per-user question: an EU citizen
// applying inside the EU never needs it. profile.workAuthorization carries the
// regions the user may already work in.
// THE FIVE TIERS, in the order a reader wants them: what the posting promises,
// what the company could do, what it rules out, silence, and the one that is
// not about the employer at all.
//
// The list lives with the function that derives it, and every surface imports
// it from here. It used to be a hand-written union in this file AND an array
// in view/radar.ts AND a label table in view/labels.ts — three spellings of
// five strings, in one feature.
export const VISA_TIERS = ["yes", "maybe", "no", "unknown", "not-needed"] as const;
export type VisaTier = (typeof VISA_TIERS)[number];

// Sources whose every posting comes from a licensed sponsor by construction
// (e.g. a board built solely from a government sponsor register). Declared
// here rather than guessed per job.
export const VISA_FOCUSED_SOURCES: ReadonlySet<string> = new Set(["huntukvisa", "visajobsie"]);

// Evidence strength: a weaker layer must never overwrite a stronger one.
const EVIDENCE_RANK: Record<string, number> = { regex: 1, source: 2, llm: 3 };

export function visaEvidenceWins(existingBy: string | null | undefined, incomingBy: string): boolean {
  const cur = EVIDENCE_RANK[existingBy ?? ""] ?? 0;
  return (EVIDENCE_RANK[incomingBy] ?? 0) >= cur;
}

export function needsSponsorship(
  jobCountry: string | null | undefined,
  authorizedRegions: readonly string[],
): boolean {
  if (!jobCountry) return true; // unknown location — assume it may be needed
  const c = jobCountry.toLowerCase();
  if (authorizedRegions.includes(c)) return false;
  // "eu" as an authorization grant covers EU member states.
  if (authorizedRegions.includes("eu") && EU_COUNTRIES.has(c)) return false;
  return true;
}

const EU_COUNTRIES = new Set([
  "at", "be", "bg", "hr", "cy", "cz", "dk", "ee", "fi", "fr", "de", "gr", "hu",
  "ie", "it", "lv", "lt", "lu", "mt", "nl", "pl", "pt", "ro", "sk", "si", "es", "se",
]);

export function deriveVisaTier(job: {
  visa: string;
  sponsorReg: boolean;
  source: string;
  country: string | null | undefined;
}, authorizedRegions: readonly string[]): VisaTier {
  if (!needsSponsorship(job.country, authorizedRegions)) return "not-needed";
  // An explicit refusal in the posting outranks the company's licence: holding
  // a sponsor licence is not a promise to use it for THIS role.
  if (job.visa === "no") return "no";
  if (job.visa === "yes") return "yes";
  if (job.sponsorReg || VISA_FOCUSED_SOURCES.has(job.source)) return "maybe";
  return "unknown";
}
