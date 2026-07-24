// Search profile. Everything scoring/filtering keys off this file — edit the
// tracks/keywords/regions below to retarget the radar to your own job search.
// Your identity (name/location) + CV live in config/user.ts (gitignored).
import { user } from "../../config/user";

export type Track = "unity" | "playable" | "ai" | "fullstack" | "other";

export const profile = {
  name: user.name,
  location: user.location,

  // A job must look remote OR be in one of these regions to survive the filter.
  acceptRegions: ["remote", "europe", "emea", "türkiye", "turkey", "turkiye", "izmir", "istanbul", "germany", "berlin", "cyprus", "poland", "lithuania"],

  // Hard floor. Postings that clearly pay under this (parsed loosely) get demoted.
  // Kept as EUR/year for reference; salary parsing is best-effort only.
  salaryFloorEURYear: 30000,

  // Tracks map a job to one of Oytun's CV variants. Scoring is TITLE-FIRST:
  // a track only wins strongly if one of its `titleKeywords` appears in the job
  // title. `bodyKeywords` add supporting weight from the description.
  // Tracks are ordered specific → generic; on a tie the earlier track wins.
  // Tune each track's title keywords independently here.
  tracks: [
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
  ],

  // Instant disqualifiers — unrelated fields the broad feeds drag in.
  negative: [
    "nurse", "patient care", "registered nurse", "sales representative", "account executive",
    "recruiter", "customer support", "teacher", "driver", "warehouse", "accountant",
    "financial advisor", "real estate", "clinical", "therapist", "marketing manager",
  ],

  // A job in a technical track must show one of these role signals in its TITLE.
  // This is what separates "Game Developer" from "Business Development Manager
  // at a game studio" — the single most effective noise filter.
  roleSignals: [
    "developer", "engineer", "programmer", "architect", "swe",
    "full stack", "fullstack", "full-stack", "backend", "frontend", "back end", "front end",
    "coder", "sde", "dev ",
  ],

  // Non-engineering roles that slip past keyword matching at tech companies.
  roleNegatives: [
    "business development", "marketing", "counsel", "legal", "events lead", "event lead",
    "compensation", "people partner", "talent", "content writer", "community manager",
    "product manager", "sales", "artist", "animator", "hr ", "human resources",
    "designer", "art director", "producer", "analyst", "accountant", "finance",
    "operations manager", "office manager", "executive assistant", "solutions architect",
    "growth", "community", "developer relations", "devrel", "developer advocate", "evangelist",
  ],
} as const;
