import { chat } from "./llm";
import { trimBoilerplate } from "./fit";

// LLM semantic dedup: is this newly stored job the SAME OPPORTUNITY as one we
// already track from the same company? Mechanical dedupe answers "same text?";
// this answers "same role?" — catching reposts under a new id, reworded titles
// ("Senior Unity Developer" vs "Sr. Unity Engineer"), and the same role listed
// per-city.
//
// Funnel, cheap to expensive — most jobs exit at stage 0 for free:
//   0. only newly stored jobs that share a company with existing rows
//   1. fast tier, titles only: "which of these COULD be the same role?"
//   2. strong tier, full descriptions, only for stage-1 candidates
//
// A confirmed duplicate keeps its row (marked duplicateOfId) so the identity
// dedupe still recognizes the source id next run, but it never renders on the
// board — and the original's lastSeenAt refreshes, because a repost proves the
// role is still open (and quietly reveals its true age to the freshness layer).

export interface DedupJob {
  id: string;
  title: string;
  description: string;
}

type ChatFn = typeof chat;

export function titlePrefilterPrompt(newTitle: string, candidates: DedupJob[]): string {
  return [
    "A company posted a new job. Below are other jobs we already track from the SAME company.",
    "Which existing jobs COULD plausibly be the same role (same position/seniority/domain)?",
    "Be liberal — include anything that might match; a later step verifies.",
    'Return STRICT JSON only: {"candidates": [<numbers from the list>]} — empty array if none.',
    "",
    `New job title: "${newTitle}"`,
    "Existing jobs:",
    ...candidates.map((c, i) => `${i + 1}. ${c.title}`),
  ].join("\n");
}

export function comparePrompt(a: { title: string; description: string }, b: DedupJob): string {
  const clip = (s: string) => trimBoilerplate(s).slice(0, 2500);
  return [
    "Two job postings from the same company. Decide if they describe the SAME opportunity:",
    "the same role reposted (possibly reworded, re-dated, or listed for another city) → same.",
    "A genuinely different position, seniority, or team → different.",
    'Return STRICT JSON only: {"sameRole": true|false}',
    "",
    `POSTING A (new):\nTitle: ${a.title}\n${clip(a.description)}`,
    "",
    `POSTING B (tracked):\nTitle: ${b.title}\n${clip(b.description)}`,
  ].join("\n");
}

// "{"candidates":[1,3]}" → [0, 2] (validated, deduped, in-range indices).
export function parseCandidateIndices(raw: string, count: number): number[] {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return [];
  try {
    const arr = JSON.parse(m[0]).candidates;
    if (!Array.isArray(arr)) return [];
    const out = new Set<number>();
    for (const v of arr) {
      const n = Math.round(Number(v));
      if (Number.isFinite(n) && n >= 1 && n <= count) out.add(n - 1);
    }
    return [...out];
  } catch {
    return [];
  }
}

export function parseSameRole(raw: string): boolean {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return false;
  try {
    return JSON.parse(m[0]).sameRole === true;
  } catch {
    return false;
  }
}

export interface DedupOutcome {
  duplicateOfId: string | null;
  compareCalls: number; // stage-2 (strong tier) calls spent
}

// Runs the funnel for one new job. Uncertainty always resolves to "not a
// duplicate" — wrongly hiding a real opening is worse than showing a repost.
export async function findDuplicate(
  newJob: { title: string; description: string },
  candidates: DedupJob[],
  chatFn: ChatFn = chat,
): Promise<DedupOutcome> {
  if (candidates.length === 0) return { duplicateOfId: null, compareCalls: 0 };

  const stage1 = await chatFn(
    [{ role: "user", content: titlePrefilterPrompt(newJob.title, candidates) }],
    { temperature: 0, maxTokens: 200, tier: "fast" },
  );
  if (!stage1) return { duplicateOfId: null, compareCalls: 0 };
  const indices = parseCandidateIndices(stage1, candidates.length);

  let compareCalls = 0;
  for (const i of indices) {
    const verdict = await chatFn(
      [{ role: "user", content: comparePrompt(newJob, candidates[i]) }],
      { temperature: 0, maxTokens: 100, tier: "strong" },
    );
    compareCalls++;
    if (verdict && parseSameRole(verdict)) {
      return { duplicateOfId: candidates[i].id, compareCalls };
    }
  }
  return { duplicateOfId: null, compareCalls };
}
