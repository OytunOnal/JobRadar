// Visa sponsorship signal, derived free at ingest from the posting text.
// Three values: "yes" (sponsorship/relocation offered), "no" (explicitly
// ruled out or right-to-work required), "unknown" (posting doesn't say —
// the honest majority). The LLM fit pass upgrades unknown→no when it reads
// an explicit refusal (fitCategory NO_VISA).
//
// Negatives are checked FIRST: "visa sponsorship is not available" must not
// match the positive "visa sponsorship" pattern.

export type VisaSignal = "yes" | "no" | "unknown";

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
