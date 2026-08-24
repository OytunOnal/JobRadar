// Seniority v2: structured level extraction (the langreq pattern — DETECTION
// is universal, JUDGMENT is per-profile). Levels are a scale, not word bags:
//   intern < junior < mid < senior < staff+ < management
// Priority when signals conflict: explicit title level > management signals
// in the description > years-of-experience. No signal at all => "unknown",
// and unknown stays neutral (user decision 2026-08-21).
// "Tech Lead" counts as senior-IC unless the description carries management
// signals (also a user decision).

export type SeniorityLevel = "intern" | "junior" | "mid" | "senior" | "staff" | "management" | "unknown";

const TITLE_LEVELS: Array<{ level: SeniorityLevel; re: RegExp }> = [
  // Management first — "Engineering Manager" must not fall through to lower
  // matches; "Head of", director, VP are unambiguous.
  { level: "management", re: /\b(head of|director|vp |vice president|chief |engineering manager|manager,? (software|engineering)|leiter(in)? )/i },
  { level: "staff", re: /\b(staff|principal|distinguished|fellow|expert engineer)\b/i },
  { level: "intern", re: /\b(intern(ship)?|werkstudent|working student|praktikant|praktikum|trainee|stagiair)\b/i },
  { level: "junior", re: /\b(junior|jr\.?|graduate|entry[ -]level|associate software|einsteiger|absolvent)\b/i },
  // senior AFTER staff (a "Senior Staff Engineer" is staff+) and multilingual:
  // starszy (PL), erfahrene (DE), senior/sr universal.
  { level: "senior", re: /\b(senior|sr\.?|starszy|erfahrene[rn]?)\b/i },
  { level: "mid", re: /\b(mid[ -]?level|intermediate|medior)\b/i },
];

// "Tech Lead"/"Lead Engineer" — IC-plus unless management signals say otherwise.
const LEAD_RE = /\b(tech lead|lead\b|teamlead|team lead)/i;

const MGMT_SIGNALS = /\b(direct reports?|people management|manage (a|the|our) team|lead a team of \d|hiring and (firing|performance)|performance reviews|budget responsibility|f(ü|u)hrungsverantwortung|personalverantwortung)\b/i;

// Years-of-experience across our markets' languages: "5+ years", "mindestens
// 3 Jahre", "minimaal 4 jaar", "min. 5 lat", "5 ans d'expérience".
const YOE_RE = /(\d{1,2})\s*\+?\s*(?:years?|yrs|jahren?|jaar|lat|ans|años|anni)\b/i;

export function detectSeniority(title: string, description: string): { level: SeniorityLevel; evidence: string } {
  // 1) Explicit title level wins.
  for (const { level, re } of TITLE_LEVELS) {
    const m = re.exec(title);
    if (m) return { level, evidence: `title: "${m[0].trim()}"` };
  }
  // Lead in the title: IC-plus by default; management if the body says so.
  if (LEAD_RE.test(title)) {
    const mgmt = MGMT_SIGNALS.exec(description);
    return mgmt
      ? { level: "management", evidence: `title lead + body: "${mgmt[0].slice(0, 40)}"` }
      : { level: "senior", evidence: "title: lead (IC by default)" };
  }
  // 2) Management signals in the body.
  const mgmt = MGMT_SIGNALS.exec(description);
  if (mgmt) return { level: "management", evidence: `body: "${mgmt[0].slice(0, 40)}"` };
  // 3) Years of experience, thresholds calibratable against dismissal labels.
  const yoe = YOE_RE.exec(description);
  if (yoe) {
    const y = Number(yoe[1]);
    const level: SeniorityLevel = y >= 8 ? "staff" : y >= 5 ? "senior" : y >= 2 ? "mid" : "junior";
    return { level, evidence: `body: "${yoe[0].trim()}"` };
  }
  return { level: "unknown", evidence: "" };
}

// Per-profile judgment: does the user's avoid-list (title words) block this
// structured level? Maps word-list vocabulary onto the level scale so the
// profile keeps ONE representation.
export function levelBlocked(level: SeniorityLevel, avoid: readonly string[]): boolean {
  const a = avoid.join(" ");
  if (level === "staff") return /staff|principal/.test(a);
  if (level === "management") return /head of|engineering manager|director|vp/.test(a);
  if (level === "senior") return /\bsenior\b/.test(a);
  if (level === "intern") return true; // no profile targets internships via avoid-lists; template negatives already kill them
  return false;
}
