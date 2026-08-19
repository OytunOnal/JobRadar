import { prisma } from "./db";
import { chat } from "./llm";
import { KNOWN_COUNTRIES, normalizeLocation, resolveCountry } from "./geo";

// Layer 2+3 of location resolution: the learned cache, and one batched LLM
// call per ingest for strings neither the gazetteer nor the cache knows.
// Every LLM answer is persisted — the same string is never asked twice.

export const LLM_BATCH_LIMIT = 80;

export async function loadLocationCache(): Promise<Map<string, string | null>> {
  const rows = await prisma.locationCache.findMany();
  return new Map(rows.map((r) => [r.raw, r.country]));
}

export function batchPrompt(raws: string[]): string {
  return [
    "Map each job-posting location string to its ISO 3166-1 alpha-2 country code (lowercase).",
    'Ambiguous, fictional, or not a real place → null. Return STRICT JSON only: {"answers": {"<number>": "<code or null>", ...}}',
    "",
    ...raws.map((r, i) => `${i + 1}. ${r}`),
  ].join("\n");
}

export function parseBatchAnswers(raw: string, count: number): Array<string | null> {
  const out: Array<string | null> = new Array(count).fill(null);
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return out;
  try {
    const answers = JSON.parse(m[0]).answers ?? {};
    for (let i = 0; i < count; i++) {
      const v = answers[String(i + 1)];
      // Hallucination guard: only codes we actually know pass.
      if (typeof v === "string" && KNOWN_COUNTRIES.has(v.toLowerCase())) {
        out[i] = v.toLowerCase();
      }
    }
  } catch {
    /* malformed → all null; they stay uncached and retry next ingest */
  }
  return out;
}

export interface LocResolveReport {
  llmAsked: number;
  llmResolved: number;
}

// Resolve the still-unknown location strings of this ingest run: one fast-tier
// call, answers cached forever, and this run's matching jobs updated in place.
// `originalsByRaw` maps each normalized string to the original spellings seen.
export async function resolveUnknownLocations(
  originalsByRaw: Map<string, Set<string>>,
  chatFn: typeof chat = chat,
): Promise<LocResolveReport> {
  const raws = [...originalsByRaw.keys()].slice(0, LLM_BATCH_LIMIT);
  if (raws.length === 0) return { llmAsked: 0, llmResolved: 0 };

  const answer = await chatFn(
    [{ role: "user", content: batchPrompt(raws) }],
    { temperature: 0, maxTokens: 1200, tier: "fast" },
  );
  if (!answer) return { llmAsked: raws.length, llmResolved: 0 };
  const countries = parseBatchAnswers(answer, raws.length);

  let resolved = 0;
  for (let i = 0; i < raws.length; i++) {
    const raw = raws[i];
    const country = countries[i];
    // Cache the nulls too — "couldn't tell" is also knowledge; hand-editable.
    await prisma.locationCache.upsert({
      where: { raw },
      create: { raw, country, resolvedBy: "llm" },
      update: {}, // never overwrite an existing (possibly hand-fixed) entry
    });
    if (country) {
      resolved++;
      await prisma.job.updateMany({
        where: { country: null, location: { in: [...originalsByRaw.get(raw)!] } },
        data: { country },
      });
    }
  }
  return { llmAsked: raws.length, llmResolved: resolved };
}

// Layer 1+2 lookup used by ingest and the rescore backfill.
export function resolveWithCache(
  location: string | null | undefined,
  cache: Map<string, string | null>,
): string | null {
  const direct = resolveCountry(location);
  if (direct) return direct;
  if (!location) return null;
  return cache.get(normalizeLocation(location)) ?? null;
}
