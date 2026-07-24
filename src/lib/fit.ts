import { chat, llmEnabled } from "./llm";
import { CV_CONTEXT } from "./cv";
import { user } from "../../config/user";

export interface FitResult {
  fitScore: number; // 0-100
  verdict: "strong" | "possible" | "weak";
  comment: string;
}

export interface JobForFit {
  title: string;
  company: string;
  location?: string | null;
  description: string;
}

// Prompt building is shared between the sync path (analyzeFit) and the batch
// path (batch.ts) so both score jobs identically.
export function fitSystemPrompt(): string {
  return [
    `You assess how well a candidate (${user.name}) fits a specific job.`,
    "Use ONLY the CV context and the job description — do not invent qualifications.",
    "Be honest and specific: name the concrete strengths AND the real gaps.",
    "Return STRICT JSON only, no prose around it, in this exact shape:",
    '{"fitScore": <0-100 integer>, "verdict": "strong"|"possible"|"weak", "comment": "<2-3 sentences: why it fits, and the main gap>"}',
    "Scoring guide: strong 70-100 (clear match), possible 40-69 (worth applying, some gaps), weak 0-39 (stretch).",
  ].join("\n");
}

export function fitUserPrompt(job: JobForFit): string {
  return [
    `CV CONTEXT:\n${CV_CONTEXT}`,
    `\nJOB:\nTitle: ${job.title}\nCompany: ${job.company}\nLocation: ${job.location ?? "n/a"}`,
    `Description:\n${job.description.slice(0, 3000)}`,
  ].join("\n");
}

// Pull the JSON object out even if the model wrapped it in text.
export function parseFit(raw: string): FitResult {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return { fitScore: 0, verdict: "weak", comment: raw.slice(0, 300) };
  try {
    const parsed = JSON.parse(match[0]);
    const score = Math.max(0, Math.min(100, Math.round(Number(parsed.fitScore) || 0)));
    const verdict: FitResult["verdict"] =
      parsed.verdict === "strong" || parsed.verdict === "possible" || parsed.verdict === "weak"
        ? parsed.verdict
        : score >= 70 ? "strong" : score >= 40 ? "possible" : "weak";
    return { fitScore: score, verdict, comment: String(parsed.comment ?? "").slice(0, 600) };
  } catch {
    return { fitScore: 0, verdict: "weak", comment: raw.slice(0, 300) };
  }
}

// Sync path: score one job now (interactive button / small top-N passes).
export async function analyzeFit(job: JobForFit): Promise<FitResult | null> {
  if (!llmEnabled()) return null;
  const raw = await chat(
    [
      { role: "system", content: fitSystemPrompt() },
      { role: "user", content: fitUserPrompt(job) },
    ],
    { temperature: 0.3, maxTokens: 400, tier: "fast" },
  );
  if (!raw) return null;
  return parseFit(raw);
}
