import { chat, llmEnabled } from "./llm";
import { CV_CONTEXT } from "./cv";
import { user } from "../../../config/user";

export interface JobForCover {
  title: string;
  company: string;
  location?: string | null;
  description: string;
}

export async function draftCoverLetter(job: JobForCover): Promise<string> {
  if (!llmEnabled()) {
    return "⚠ No GROQ_API_KEY set. Add your Groq key to .env to enable cover-letter drafting.";
  }

  const system = [
    `You write short, grounded cover letters for a software engineer named ${user.name}.`,
    "Rules:",
    "- Use ONLY facts from the provided CV context. Never invent employers, metrics, or skills.",
    "- Plain, human tone. No buzzwords, no 'I am thrilled', no exaggeration.",
    "- 180-260 words. Open by connecting a specific point in the job to the candidate's real experience.",
    "- Pick the 2-3 most relevant experiences for THIS job; ignore the rest.",
    `- End with one plain sentence of interest. Sign off as '${user.name}'.`,
    "- Output only the letter body, no subject line, no placeholders like [Company].",
  ].join("\n");

  const userPrompt = [
    `CV CONTEXT:\n${CV_CONTEXT}`,
    `\nJOB POSTING:\nTitle: ${job.title}\nCompany: ${job.company}\nLocation: ${job.location ?? "n/a"}`,
    `Description (truncated):\n${job.description.slice(0, 2500)}`,
    "\nWrite the cover letter now.",
  ].join("\n");

  const out = await chat(
    [
      { role: "system", content: system },
      { role: "user", content: userPrompt },
    ],
    { temperature: 0.6, maxTokens: 700 },
  );

  return out?.trim() || "Draft failed — the model returned nothing. Try again.";
}
