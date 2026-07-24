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
  tags: string[]; // informational: what kind of company this is
}

export const companies: Company[] = [
  // --- Casual / mobile games (example niche: incl. Turkish studios) ---
  { name: "Dream Games", provider: "lever", token: "dreamgames", tags: ["games", "casual", "turkey"] },
  { name: "Peak Games", provider: "greenhouse", token: "peak", tags: ["games", "casual", "turkey"] },
  { name: "Good Job Games", provider: "greenhouse", token: "goodjobgames", tags: ["games", "casual", "turkey"] },
  { name: "Gameloft", provider: "smartrecruiters", token: "Gameloft", tags: ["games", "mobile"] },
  { name: "Scopely", provider: "greenhouse", token: "scopely", tags: ["games", "mobile"] },
  { name: "Wooga", provider: "greenhouse", token: "wooga", tags: ["games", "casual"] },
  { name: "Voodoo", provider: "lever", token: "voodoo", tags: ["games", "playable", "hypercasual"] },

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
  { name: "Linear", provider: "ashby", token: "linear", tags: ["tech"] },
];

// One Source per company. A failing company doesn't sink the batch (ingest
// catches per-source errors).
export function companySources(): Source[] {
  return companies.map((c) => ({
    name: `${c.provider}:${c.token}`,
    fetch: () => atsFetchers[c.provider](c.token, c.name),
  }));
}
