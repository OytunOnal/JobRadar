// Search profile. Scoring/filtering keys off this file. Three layers, most
// personal wins:
//   1. explicit overrides in gitignored config/user.ts (tracks, acceptRegions)
//   2. the CV-generated profile (npm run profile:generate → reviewed JSON)
//   3. the built-in template defaults below (game-dev/AI flavored sample)
// Role signals/negatives are mirrors derived from the universal taxonomy when
// a generated profile selects families — that's what makes the pipeline work
// for a PM or a designer the same way it works for a developer.
import { user } from "../../config/user";
import { CV_CONTEXT } from "./cv";
import { cvHash, loadGeneratedProfile } from "./profilegen";
import { loadSettings, settingsStamp } from "./settings";
import { deriveRoleNegatives, deriveRoleSignals } from "./taxonomy";

export type Track = string;

export { SEARCH_LANGS, type SearchLang } from "./langs";
import type { SearchLang } from "./langs";

// One group per specific track: its search names by language. EN always starts
// with the lead titleKeyword, so a variant-less profile keeps working. Shared
// by every search-driven source (LinkedIn, EURES, Arbeitsagentur, freehire).
export type SearchGroup = Partial<Record<SearchLang, string[]>> & { en: string[] };

export interface TrackDef {
  key: Track;
  label: string;
  titleKeywords: string[];
  bodyKeywords: string[];
  // Per-track seniority appetite override — the user's level differs per
  // field (a 10y Unity dev welcomes "lead" there but is junior-mid in a
  // newer field). Absent fields fall back to the profile-global lists.
  seniority?: { boost?: string[]; avoid?: string[] };
  // Search-side title variants per language ("organize by function, not job
  // title" — the same work ships under many names, and German/Dutch/French/
  // Spanish postings use local titles English queries never see). Populated
  // by profile:generate; scoring ignores this field entirely.
  searchVariants?: Partial<Record<SearchLang, string[]>>;
}

// Optional overrides a user may add to config/user.ts.
const u = user as typeof user & {
  tracks?: TrackDef[];
  acceptRegions?: string[];
  targetRoles?: string;
};

const generated = loadGeneratedProfile();
// Stale = the CV (or stated target) changed after generation; scoring still
// works, but the radar is aimed at the old CV. Ingest surfaces a warning.
export const generatedProfileStale =
  generated !== null && generated.cvHash !== cvHash(CV_CONTEXT, u.targetRoles);

// A job must look remote OR be in one of these regions to survive the filter.
const defaultRegions = ["remote", "europe", "emea", "türkiye", "turkey", "turkiye", "izmir", "istanbul", "germany", "berlin", "cyprus", "poland", "lithuania"];

function buildProfile() {
  const settings = loadSettings();
  return {
  name: user.name,
  location: user.location,

  acceptRegions: settings.acceptRegions ?? u.acceptRegions ?? defaultRegions,

  // Hard floor. Postings that clearly pay under this (parsed loosely) get demoted.
  // Kept as EUR/year for reference; salary parsing is best-effort only.
  salaryFloorEURYear: settings.salaryFloorEURYear ?? 30000,

  // Tracks map a job to one of your CV variants / target roles. Scoring is TITLE-FIRST:
  // a track only wins strongly if one of its `titleKeywords` appears in the job
  // title. `bodyKeywords` add supporting weight from the description.
  // Tracks are ordered specific → generic; on a tie the earlier track wins.
  // Precedence: config/user.ts override > CV-generated profile > this template.
  tracks: settings.tracks ?? u.tracks ?? generated?.tracks ?? ([
    {
      key: "playable" as Track,
      label: "Playable Ads",
      titleKeywords: ["playable", "creative technologist", "html5 game"],
      bodyKeywords: ["playable ad", "luna labs", "luna sdk", "cocos", "pixi", "phaser", "three.js", "ad network", "applovin", "ironsource", "user acquisition"],
    },
    {
      key: "unity" as Track,
      label: "Unity / Games",
      titleKeywords: ["unity", "game developer", "gameplay", "game programmer", "game engineer", "engine programmer", "graphics programmer", "unity3d"],
      bodyKeywords: ["unity", "c#", ".net", "mobile game", "casual game", "instant game", "gameplay", "game engine", "profiling", "shader"],
    },
    {
      key: "ai" as Track,
      label: "AI / LLM Engineer",
      titleKeywords: ["ai engineer", "ml engineer", "machine learning", "llm", "ai developer", "genai", "generative ai", "ai/ml", "applied ai", "ai agent", "nlp", "deep learning"],
      bodyKeywords: ["prompt engineering", "rag", "openai", "anthropic", "claude", "langchain", "vector", "embeddings", "fine-tuning", "pytorch", "tensorflow", "python"],
    },
    {
      key: "fullstack" as Track,
      label: "Full-Stack",
      titleKeywords: ["full stack", "fullstack", "full-stack", "backend", "back-end", "frontend", "front-end", "software engineer", "web developer", "node.js"],
      bodyKeywords: ["typescript", "node", "react", "next.js", "postgres", "supabase", "api", "serverless", "docker"],
    },
  ] satisfies TrackDef[]),

  // Instant disqualifiers — unrelated fields the broad feeds drag in.
  negative: [
    "nurse", "patient care", "registered nurse", "sales representative", "account executive",
    "recruiter", "customer support", "teacher", "accountant",
    "financial advisor", "real estate", "therapist", "marketing manager",
    // NOT here: "warehouse"/"driver"/"clinical" — they collided with Data
    // Warehouse architects, Driver Software Engineers and clinical-data
    // engineering; their true targets carry no engineering title word and
    // die at the role-signal gate regardless.
    // Seniority noise for this senior-focused profile: student/intern postings.
    "werkstudent", "praktikum", "praktikant", "working student", "internship",
  ],

  // A job must announce one of these role signals in its TITLE. This is what
  // separates "Game Developer" from "Business Development Manager at a game
  // studio" — the single most effective noise filter. With a generated profile
  // these derive from the selected taxonomy families (a PM's signals are a
  // developer's negatives — same table, mirrored); the hardcoded lists below
  // are the engineering-flavored template fallback.
  roleSignals: generated
    ? deriveRoleSignals(generated.families)
    : [
        "developer", "engineer", "programmer", "architect", "swe",
        "full stack", "fullstack", "full-stack", "backend", "frontend", "back end", "front end",
        "coder", "sde", "dev ",
      ],

  // Regions/countries where the candidate ALREADY has the right to work
  // (ISO alpha-2, or "eu" for EU-wide rights). Jobs there need no sponsorship
  // and drop out of the visa axis entirely — an EU citizen applying inside the
  // EU should never see a visa chip. Empty = assume sponsorship is needed
  // everywhere (the conservative default).
  workAuthorization: settings.workAuthorization ?? generated?.workAuthorization ?? [],

  // Languages the candidate can work in (ISO codes). Detection of a posting's
  // language REQUIREMENTS is universal (lib/langreq.ts); whether a requirement
  // is a barrier is judged against this list.
  languages: settings.languages ?? generated?.languages ?? ["en"],

  // Seniority appetite — title words to lift or demote in keyword scoring and
  // to state in the fit prompt. Per-user by design: a new grad boosts
  // "junior", an IC avoids "head of". Template default mirrors the old
  // hardcoded behavior so template users see no change.
  seniorityBoost: settings.seniority?.boost ?? generated?.seniority?.boost ?? ["senior", "lead", "staff"],
  seniorityAvoid: settings.seniority?.avoid ?? generated?.seniority?.avoid ?? [],

  // Roles from every UNSELECTED family — the mirror of roleSignals.
  roleNegatives: (generated
    ? deriveRoleNegatives(generated.families)
    : [
        "business development", "marketing", "counsel", "legal", "events lead", "event lead",
        "compensation", "people partner", "talent", "content writer", "community manager",
        "product manager", "sales", "artist", "animator", "hr ", "human resources",
        "designer", "art director", "producer", "analyst", "accountant", "finance",
        "operations manager", "office manager", "executive assistant", "solutions architect",
        "growth", "community", "developer relations", "devrel", "developer advocate", "evangelist",
      ]
  // User-specific role exclusions ride roleNegatives (NOT the hard negatives)
  // on purpose: the specific-track title override still applies, so e.g. a
  // "Unity iOS Developer" posting survives an "ios developer" exclusion.
  ).concat(settings.extraRoleNegatives ?? generated?.extraRoleNegatives ?? []),

  // Aggregator search strings (JSearch/Adzuna). Env vars still win; the
  // generated profile supplies persona-appropriate defaults.
  searchQueries: settings.searchQueries ?? generated?.searchQueries ?? null,
  } as const;
}

// A live view, not a frozen snapshot: the profile page writes settings.json and
// the very next read here reflects it — no server restart, and every existing
// `profile.x` call site keeps working untouched.
//
// Memoised on the settings file's own stamp, because the naive Proxy rebuilt
// EVERYTHING on every property read: loadSettings (a readFileSync), then the
// role-negative and role-signal derivations over the whole track list.
// scoreJob touches profile 7-9 times per posting, so a rescore over half a
// million rows meant millions of syscalls — measured at 0.12 ms per read,
// roughly half of scoring. The stamp is what loadSettings already computes to
// decide whether ITS cache is fresh, so a hand edit to settings.json is still
// picked up on the next read.
let memo: ReturnType<typeof buildProfile> | null = null;
let memoStamp = "";

function currentProfile(): ReturnType<typeof buildProfile> {
  const stamp = settingsStamp();
  if (memo !== null && stamp === memoStamp) return memo;
  memo = buildProfile();
  memoStamp = stamp;
  return memo;
}

export const profile = new Proxy({} as ReturnType<typeof buildProfile>, {
  get: (_t, key: string) => (currentProfile() as Record<string, unknown>)[key],
  has: (_t, key: string) => key in currentProfile(),
  ownKeys: () => Reflect.ownKeys(currentProfile()),
  getOwnPropertyDescriptor: (_t, key: string) => ({
    ...Object.getOwnPropertyDescriptor(currentProfile(), key),
    configurable: true,
  }),
});

// Which of a posting's required languages are BARRIERS for this user.
//
// The module used to answer only "what did the user configure", so every caller
// that needed this question took the raw field and answered it itself — three
// byte-identical copies of `(c) => !profile.languages.includes(c)` in the
// radar, the fit prompt and the judge queue, over an identically-parsed code
// list. That is what a shallow, wide module does to its callers: it makes them
// each carry the same reasoning.
//
// The question belongs here because the answer depends entirely on the user,
// not on the posting: the same "de" is a wall for one profile and nothing for
// another. Callers render the result differently — a badge joins names with
// "/", the prompt with ", " — but they no longer decide WHAT a barrier is.
export function languageBarriers(langReq: string | null | undefined): string[] {
  return (langReq ?? "")
    .split(",")
    .filter(Boolean)
    .filter((c) => !profile.languages.includes(c));
}

// Resolve the seniority appetite for a track: track override wins, global
// lists fall back per-field (a track may override only `avoid`).
export function seniorityFor(track: string | null | undefined): { boost: string[]; avoid: string[] } {
  const t = track ? profile.tracks.find((x) => x.key === track) : undefined;
  return {
    boost: t?.seniority?.boost ?? [...profile.seniorityBoost],
    avoid: t?.seniority?.avoid ?? [...profile.seniorityAvoid],
  };
}

export function profileSearchGroups(max = 4): SearchGroup[] {
  return profile.tracks
    .filter((t) => !t.key.startsWith("general-") && t.titleKeywords.length > 0)
    .slice(0, max)
    .map((t) => {
      const v = t.searchVariants ?? {};
      return { ...v, en: [...new Set([t.titleKeywords[0], ...(v.en ?? [])])] };
    });
}
