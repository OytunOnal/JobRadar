import { fitSystemPrompt, fitUserPrompt, parseFit, type FitResult, type JobForFit } from "./fit";

// Anthropic Message Batches API — async, 50% cheaper, no per-request rate-limit
// juggling. Used to fit-score the whole board in one submission.
// https://api.anthropic.com/v1/messages/batches

const BASE = "https://api.anthropic.com/v1/messages/batches";
const MODEL = process.env.ANTHROPIC_FIT_MODEL || "claude-haiku-4-5";

function headers() {
  return {
    "content-type": "application/json",
    "x-api-key": process.env.ANTHROPIC_API_KEY ?? "",
    "anthropic-version": "2023-06-01",
  };
}

export interface JobForBatch extends JobForFit {
  id: string;
}

// Submit one fit request per job; returns the batch id.
export async function submitFitBatch(jobs: JobForBatch[]): Promise<string> {
  const requests = jobs.map((j) => ({
    custom_id: j.id,
    params: {
      model: MODEL,
      max_tokens: 400,
      temperature: 0.3,
      system: fitSystemPrompt(),
      messages: [{ role: "user", content: fitUserPrompt(j) }],
    },
  }));
  const res = await fetch(BASE, { method: "POST", headers: headers(), body: JSON.stringify({ requests }) });
  if (!res.ok) throw new Error(`batch create ${res.status}: ${(await res.text()).slice(0, 400)}`);
  const data = await res.json();
  return data.id as string;
}

export interface BatchStatus {
  status: string; // in_progress | canceling | ended
  counts: Record<string, number>;
  resultsUrl: string | null;
}

export async function getBatch(id: string): Promise<BatchStatus> {
  const res = await fetch(`${BASE}/${id}`, { headers: headers() });
  if (!res.ok) throw new Error(`batch get ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const d = await res.json();
  return { status: d.processing_status, counts: d.request_counts ?? {}, resultsUrl: d.results_url ?? null };
}

export interface BatchResult {
  jobId: string;
  fit: FitResult | null;
}

// Fetch the JSONL results and parse each into a FitResult keyed by job id.
export async function fetchResults(resultsUrl: string): Promise<BatchResult[]> {
  const res = await fetch(resultsUrl, { headers: headers() });
  if (!res.ok) throw new Error(`batch results ${res.status}`);
  const text = await res.text();
  const out: BatchResult[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    if (r.result?.type !== "succeeded") {
      out.push({ jobId: r.custom_id, fit: null });
      continue;
    }
    const content = (r.result.message.content ?? [])
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("");
    out.push({ jobId: r.custom_id, fit: parseFit(content) });
  }
  return out;
}
