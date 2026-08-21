import { atsFetchers, type AtsProvider } from "./ats";
import type { RawJob, Source } from "./types";

// Curated, verified list of companies to watch directly via their ATS.
// All tokens below were probe-tested and return live postings.
// To add a company: find its board token and add a line — no other code changes.
//   Greenhouse: boards-api.greenhouse.io/v1/boards/<token>/jobs
//   Lever:      api.lever.co/v0/postings/<token>?mode=json
//   Ashby:      api.ashbyhq.com/posting-api/job-board/<token>
//   SmartRec.:  api.smartrecruiters.com/v1/companies/<token>/postings

export interface Company {
  name: string;
  provider: AtsProvider;
  token: string;
  // Regional ATS instance, e.g. "eu" for boards at jobs.eu.lever.co — Lever's
  // EU deployment has a separate slug namespace (EU boards 404 on the US API).
  region?: string;
  tags: string[]; // informational: what kind of company this is
}

export const companies: Company[] = [
  // --- Casual / mobile games (example niche: incl. Turkish studios) ---
  { name: "Dream Games", provider: "lever", token: "dreamgames", tags: ["games", "casual", "turkey"] },
  // Peak Games removed 2026-08-19: validation showed gh:peak now serves a
  // different company entirely ("Peak Physical Therapy"), and no Greenhouse
  // board exists under peakgames/peak-games. (Zynga-owned; likely hires
  // through Zynga's channels now.)
  { name: "Good Job Games", provider: "greenhouse", token: "goodjobgames", tags: ["games", "casual", "turkey"] },
  { name: "Gameloft", provider: "smartrecruiters", token: "Gameloft", tags: ["games", "mobile"] },
  { name: "Scopely", provider: "greenhouse", token: "scopely", tags: ["games", "mobile"] },
  { name: "Wooga", provider: "greenhouse", token: "wooga", tags: ["games", "casual"] },
  // Moved from Lever (validated dead there) to Ashby — probe-verified live.
  { name: "Voodoo", provider: "ashby", token: "voodoo", tags: ["games", "playable", "hypercasual"] },

  { name: "Codeway", provider: "ashby", token: "codeway", tags: ["mobile", "turkey"] },
  { name: "Supercell", provider: "ashby", token: "supercell", tags: ["games", "mobile"] },
  { name: "Tripledot Studios", provider: "greenhouse", token: "tripledotstudios", tags: ["games", "casual"] },
  { name: "Remedy", provider: "greenhouse", token: "remedy", tags: ["games"] },

  // --- Platforms / bigger games ---
  { name: "Roblox", provider: "greenhouse", token: "roblox", tags: ["games", "platform"] },
  { name: "Discord", provider: "greenhouse", token: "discord", tags: ["platform", "games"] },

  // --- Adtech / playable-adjacent ---
  { name: "AppLovin", provider: "greenhouse", token: "applovin", tags: ["adtech", "playable"] },
  { name: "Liftoff", provider: "greenhouse", token: "liftoff", tags: ["adtech", "playable"] },

  // --- AI / LLM companies ---
  { name: "OpenAI", provider: "ashby", token: "openai", tags: ["ai"] },
  { name: "Anthropic", provider: "greenhouse", token: "anthropic", tags: ["ai"] },
  { name: "Cohere", provider: "ashby", token: "cohere", tags: ["ai"] },
  { name: "ElevenLabs", provider: "ashby", token: "elevenlabs", tags: ["ai"] },
  { name: "Scale AI", provider: "greenhouse", token: "scaleai", tags: ["ai"] },
  { name: "Databricks", provider: "greenhouse", token: "databricks", tags: ["ai", "data"] },
  { name: "Runway", provider: "ashby", token: "runway", tags: ["ai", "creative"] },
  { name: "xAI", provider: "greenhouse", token: "xai", tags: ["ai"] },
  { name: "Google DeepMind", provider: "greenhouse", token: "deepmind", tags: ["ai"] },
  { name: "Perplexity", provider: "ashby", token: "perplexity", tags: ["ai"] },
  { name: "LangChain", provider: "ashby", token: "langchain", tags: ["ai"] },
  { name: "Stability AI", provider: "greenhouse", token: "stabilityai", tags: ["ai"] },

  // --- Remote-first / EU tech (fullstack-friendly) ---
  { name: "Linear", provider: "ashby", token: "linear", tags: ["tech"] },
  { name: "GitLab", provider: "greenhouse", token: "gitlab", tags: ["tech", "remote-first"] },
  { name: "Vercel", provider: "greenhouse", token: "vercel", tags: ["tech", "remote-first"] },
  { name: "Supabase", provider: "ashby", token: "supabase", tags: ["tech", "remote-first"] },
  { name: "PostHog", provider: "ashby", token: "posthog", tags: ["tech", "remote-first"] },
  { name: "Railway", provider: "ashby", token: "railway", tags: ["tech", "remote-first"] },
  { name: "Resend", provider: "ashby", token: "resend", tags: ["tech", "remote-first"] },
  { name: "Grafana Labs", provider: "greenhouse", token: "grafanalabs", tags: ["tech", "remote-first"] },
  { name: "Datadog", provider: "greenhouse", token: "datadog", tags: ["tech"] },
  { name: "MongoDB", provider: "greenhouse", token: "mongodb", tags: ["tech"] },
  { name: "Remote.com", provider: "greenhouse", token: "remotecom", tags: ["tech", "remote-first"] },
  { name: "Monzo", provider: "greenhouse", token: "monzo", tags: ["tech", "fintech"] },
  { name: "N26", provider: "greenhouse", token: "n26", tags: ["tech", "fintech", "eu"] },

  // --- Enterprise ATS wave 2 seeds (all probe-verified live 2026-08-21) ---
  { name: "Mercedes-Benz", provider: "beesite", token: "mercedes-benz-beesite-production-gjb", tags: ["enterprise", "de", "automotive"] },
  { name: "MAN Truck & Bus", provider: "successfactors", token: "jobs.man.eu", tags: ["enterprise", "de", "automotive"] },
  { name: "TRATON Group", provider: "successfactors", token: "jobs.traton.com", tags: ["enterprise", "de", "automotive"] },
  { name: "Bayer", provider: "eightfold", token: "bayer", tags: ["enterprise", "de", "pharma"] },
  { name: "Rippling", provider: "rippling", token: "rippling", tags: ["tech", "hr"] },
];

// One Source per company. A failing company doesn't sink the batch (ingest
// catches per-source errors).
export function companySources(): Source[] {
  return companies.map((c) => ({
    name: `${c.provider}:${c.token}`,
    fetch: () => atsFetchers[c.provider](c.token, c.name, c.region ?? ""),
  }));
}
