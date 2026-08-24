import { readFileSync } from "node:fs";
import { postingView } from "../text/sections";
import { TEXT_VERSION } from "../text/html-text";

// Embedding layer for the blended fit-queue priority (bake-off winner:
// qwen3-embedding:0.6b, whole-CV query, measured 2026-08-21 — see
// config/embed-profiles.json and the eval commit). Vectors are stored on Job
// as Float32 buffers; similarity to the CV is recomputed locally in
// milliseconds, so a CV edit never touches the network for the pool.

export const EMBED_MODEL = process.env.EMBED_MODEL ?? "qwen3-embedding:0.6b";
const OLLAMA = process.env.OLLAMA_URL ?? "http://localhost:11434";

// Blend weight from the tune/confirm weight sweep: the 30–40% keyword band is
// a plateau; 40 was best on the confirm and 27B-gold slices. Re-run the sweep
// as the gold set grows and update here.
export const KEYWORD_WEIGHT = 0.4;

// How the job side was turned into text. Bump when the embed view or its
// budget changes — a vector built from a different projection is not
// comparable to one built from this projection, and the only way to notice is
// to record which one it was.
export const EMBED_VIEW_VERSION = "s2500";

// The provenance stamp on every vector: WHICH PROJECTION produced it.
//
// It deliberately does not encode the text version. That was tried twice and
// both shapes were wrong. Stamping the code's TEXT_VERSION lied — a vector
// built from an old description claimed to be current. Stamping the row's own
// version and then comparing it to the constant made the question
// unanswerable: with TEXT_VERSION at t3 and no row yet carrying t3, 445,358
// vectors that already existed were permanently "stale", re-embedded on every
// pass and never cleared, and the worker's idle lane became a hot loop.
//
// The mistake in both was treating "is this vector current?" as arithmetic
// over two rows' versions. It is not — it is cache invalidation, and the
// writer does it: everything that rewrites a description clears the vector's
// stamp (invalidateVector below). Staleness is then a plain single-row test.
export function embedStamp(): string {
  return EMBED_VIEW_VERSION;
}

// Called by every writer of JobContent.description. A description that changed
// is a vector that no longer describes its job, and the write is the only
// moment that fact is known cheaply.
// updateMany, not update: a job may have no vector yet, and that is the
// common case rather than an error.
export async function invalidateVector(
  db: { jobEmbedding: { updateMany: (args: { where: { jobId: string }; data: { builtFrom: null } }) => Promise<unknown> } },
  jobId: string,
): Promise<void> {
  await db.jobEmbedding.updateMany({ where: { jobId }, data: { builtFrom: null } });
}

// "This job needs embedding." One definition, because there are three callers
// (the counter, the walker, the worker) and a copy that drifts is how a queue
// reports zero work while half of it is stale.
//
// The `builtFrom: null` arm is not redundant: in SQL, NULL is not "different
// from" anything, so `builtFrom != stamp` silently skips every row written
// before the column existed — which was all of them.
export function staleVectorWhere() {
  return {
    OR: [
      { vector: { is: null } },
      { vector: { model: { not: EMBED_MODEL } } },
      // Cleared by whoever last rewrote the description.
      { vector: { builtFrom: null } },
      { vector: { builtFrom: { not: embedStamp() } } },
    ],
  };
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  const res = await fetch(`${OLLAMA}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBED_MODEL, input: texts }),
    signal: AbortSignal.timeout(300_000),
  });
  if (!res.ok) throw new Error(`embed ${EMBED_MODEL} -> HTTP ${res.status}`);
  const data = (await res.json()) as { embeddings: number[][] };
  if (!data.embeddings || data.embeddings.length !== texts.length) {
    throw new Error(`embed returned ${data.embeddings?.length} vectors for ${texts.length} texts`);
  }
  return data.embeddings.map(normalize);
}

export function normalize(v: number[]): number[] {
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / n);
}

export function toBuffer(v: number[]): Uint8Array<ArrayBuffer> {
  const f = new Float32Array(v);
  return new Uint8Array(f.buffer as ArrayBuffer, 0, f.byteLength);
}

export function fromBuffer(b: Uint8Array): number[] {
  return [...new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4)];
}

export function cosine(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s; // inputs are normalized
}

// The job-side embed text: title + what the job IS (the bake-off's "td"
// variant — tune winner; title-only rows embed on their title alone).
//
// The body is now the sectioned view rather than the first 1500 characters.
// A blind head slice meant a posting opening with company history produced a
// vector describing the COMPANY, and every such job sat near every other one
// no matter what the role was. Benefits blurbs do the same thing: they are
// near-identical across postings, so they pull all vectors toward one point.
export function jobEmbedText(title: string, description: string | null): string {
  const desc = description ? postingView(description, "embed") : "";
  return desc && desc.length > title.length + 20 ? `${title}\n${desc}` : title;
}

export async function cvVector(): Promise<number[]> {
  const cv = readFileSync("config/cv.txt", "utf8");
  return (await embedTexts([cv]))[0];
}

// Blended queue priority: rank by keyword, rank by similarity, weighted rank
// average — lower is better. Jobs without a vector fall back to their keyword
// rank on the embedding side (neutral, not penalized). Callers put hard
// priorities (sponsor register / explicit visa) ABOVE the blend themselves.
export function blendOrder<T extends { score: number; sim: number | null }>(jobs: T[]): T[] {
  const kwRank = rank(jobs.map((j) => j.score));
  const known = jobs.map((j, i) => [j.sim, i] as const).filter(([s]) => s !== null) as [number, number][];
  const simRank = new Array<number>(jobs.length);
  // Rank the embedded subset among itself, then scale to the full range so
  // the two rank scales stay comparable.
  const scale = known.length > 1 ? (jobs.length - 1) / (known.length - 1) : 1;
  const sortedKnown = [...known].sort((a, b) => b[0] - a[0]);
  sortedKnown.forEach(([, idx], pos) => { simRank[idx] = pos * scale; });
  jobs.forEach((j, i) => { if (j.sim === null) simRank[i] = kwRank[i]; });
  return jobs
    .map((j, i) => ({ j, key: KEYWORD_WEIGHT * kwRank[i] + (1 - KEYWORD_WEIGHT) * simRank[i] }))
    .sort((a, b) => a.key - b.key)
    .map((x) => x.j);
}

function rank(vals: number[]): number[] {
  const idx = vals.map((v, i) => [v, i] as const).sort((a, b) => b[0] - a[0]);
  const r = new Array(vals.length).fill(0);
  idx.forEach(([, i], pos) => { r[i] = pos; });
  return r;
}
