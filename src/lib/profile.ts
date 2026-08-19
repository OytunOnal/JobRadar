// Search profile. Scoring/filtering keys off this file. Three layers, most
// personal wins:
//   1. explicit overrides in gitignored config/user.ts (tracks, acceptRegions)
//   2. the CV-generated profile (npm run profile:generate → reviewed JSON)
//   3. the built-in template defaults below (game-dev/AI flavored sample)
// Role signals/negatives are mirrors derived from the universal taxonomy when
// a generated profile selects families — that's what makes the pipeline work
// for a PM or a designer the same way it works for a developer.
import { user } from "../../config/user";
import { cvHash, loadGeneratedProfile } from "./profilegen";
import { deriveRoleNegatives, deriveRoleSignals } from "./taxonomy";

export type Track = string;

export interface TrackDef {
  key: Track;
  label: string;
  titleKeywords: string[];
  bodyKeywords: string[];
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
  generated !== null && generated.cvHash !== cvHash(user.cv, u.targetRoles);

// A job must look remote OR be in one of these regions to survive the filter.
const defaultRegions = ["remote", "europe", "emea", "türkiye", "turkey", "turkiye", "izmir", "istanbul", "germany", "berlin", "cyprus", "poland", "lithuania"];

export const profile = {
  name: user.name,
  location: user.location,

  acceptRegions: u.acceptRegions ?? defaultRegions,

  // Hard floor. Postings that clearly pay under this (parsed loosely) get demoted.
  // Kept as EUR/year for reference; salary parsing is best-effort only.
  salaryFloorEURYear: 30000,

  // Tracks map a job to one of your CV variants / target roles. Scoring is TITLE-FIRST:
  // a track only wins strongly if one of its `titleKeywords` appears in the job
  // title. `bodyKeywords` add supporting weight from the description.
  // Tracks are ordered specific → generic; on a tie the earlier track wins.
  // Precedence: config/user.ts override > CV-generated profile > this template.
  tracks: u.tracks ?? generated?.tracks ?? ([
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
    "recruiter", "customer support", "teacher", "driver", "warehouse", "accountant",
    "financial advisor", "real estate", "clinical", "therapist", "marketing manager",
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

  // Roles from every UNSELECTED family — the mirror of roleSignals.
  roleNegatives: generated
    ? deriveRoleNegatives(generated.families)
    : [
        "business development", "marketing", "counsel", "legal", "events lead", "event lead",
        "compensation", "people partner", "talent", "content writer", "community manager",
        "product manager", "sales", "artist", "animator", "hr ", "human resources",
        "designer", "art director", "producer", "analyst", "accountant", "finance",
        "operations manager", "office manager", "executive assistant", "solutions architect",
        "growth", "community", "developer relations", "devrel", "developer advocate", "evangelist",
      ],

  // Aggregator search strings (JSearch/Adzuna). Env vars still win; the
  // generated profile supplies persona-appropriate defaults.
  searchQueries: generated?.searchQueries ?? null,
} as const;
