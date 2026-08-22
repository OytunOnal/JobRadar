// Embedding bake-off: can local embedding similarity predict the LLM's fit
// verdicts better than the keyword score does? Ground truth = jobs that
// already have a fitScore (zero new LLM cost). Query texts are FROZEN in
// config/embed-profiles.json — do not tune them against these results.
//
//   npx tsx scripts/embed-eval.ts            (embeds + scores, caches vectors)
//
// Matrix: 5 models x 4 query strategies x 2 job-text variants.
// Metrics per config, computed on a deterministic tune/confirm split:
//   - precision@100  (share of top-100 with fitScore >= 70)
//   - spearman rank correlation vs fitScore
//   - gem recall     (share of fitScore >= 80 jobs inside the top 20%)
// Baseline: the keyword `score` column ranked the same way.
// Gold slice = 27B-reviewed jobs; multilingual slice = non-English titles.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "../src/lib/db";

const MODELS = [
  "bge-m3",
  "qwen3-embedding:0.6b",
  "embeddinggemma",
  "snowflake-arctic-embed2",
  "nomic-embed-text",
];
const VARIANTS = ["t", "td"] as const; // title-only | title+desc(1500)
const STRATEGIES = ["cv", "facets", "ads", "mix"] as const;
const CACHE_DIR = "data/embed-cache";
const OLLAMA = process.env.OLLAMA_URL ?? "http://localhost:11434";

type Vec = number[];
interface JobRow {
  id: string;
  title: string;
  desc: string;
  keyword: number;
  fit: number;
  gold: boolean;
  nonEnglish: boolean;
  tune: boolean;
}

const NON_EN = /[äöüßàâçéèêëîïñóôûåøæłśżčğışİ]|entwickler|ontwikkelaar|développeur|desarrollador|programista|sviluppatore|utvecklare|ingenieur|udvikler/i;

function hashSplit(id: string): boolean {
  // Deterministic ~50/50: sum of char codes parity. Stable across runs.
  let h = 0;
  for (const c of id) h = (h + c.charCodeAt(0)) % 997;
  return h % 2 === 0;
}

async function embedBatch(model: string, texts: string[]): Promise<Vec[]> {
  const res = await fetch(`${OLLAMA}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, input: texts }),
    signal: AbortSignal.timeout(300_000),
  });
  if (!res.ok) throw new Error(`${model} embed HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { embeddings: Vec[] };
  if (!data.embeddings || data.embeddings.length !== texts.length) {
    throw new Error(`${model} returned ${data.embeddings?.length} vectors for ${texts.length} texts`);
  }
  return data.embeddings;
}

async function embedAll(model: string, texts: string[], label: string): Promise<Vec[]> {
  const out: Vec[] = [];
  const BATCH = 32;
  for (let i = 0; i < texts.length; i += BATCH) {
    out.push(...(await embedBatch(model, texts.slice(i, i + BATCH))));
    if (i % (BATCH * 10) === 0 && i > 0) console.log(`    ${label}: ${i}/${texts.length}`);
  }
  return out;
}

function norm(v: Vec): Vec {
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / n);
}
function dot(a: Vec, b: Vec): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function spearman(xs: number[], ys: number[]): number {
  const rank = (v: number[]) => {
    const idx = v.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
    const r = new Array(v.length).fill(0);
    let i = 0;
    while (i < idx.length) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
      i = j + 1;
    }
    return r;
  };
  const rx = rank(xs), ry = rank(ys);
  const mx = rx.reduce((a, b) => a + b, 0) / rx.length;
  const my = ry.reduce((a, b) => a + b, 0) / ry.length;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < rx.length; i++) {
    num += (rx[i] - mx) * (ry[i] - my);
    dx += (rx[i] - mx) ** 2;
    dy += (ry[i] - my) ** 2;
  }
  return num / (Math.sqrt(dx * dy) || 1);
}

interface Metrics { p100: number; rho: number; gemRecall: number; n: number }
function metrics(rows: { sim: number; fit: number }[]): Metrics {
  const sorted = [...rows].sort((a, b) => b.sim - a.sim);
  const top100 = sorted.slice(0, Math.min(100, sorted.length));
  const p100 = top100.filter((r) => r.fit >= 70).length / top100.length;
  const gems = rows.filter((r) => r.fit >= 80).length;
  const topN = Math.ceil(sorted.length * 0.2);
  const gemsInTop = sorted.slice(0, topN).filter((r) => r.fit >= 80).length;
  return {
    p100,
    rho: spearman(rows.map((r) => r.sim), rows.map((r) => r.fit)),
    gemRecall: gems ? gemsInTop / gems : 0,
    n: rows.length,
  };
}

async function main() {
  mkdirSync(CACHE_DIR, { recursive: true });
  const profiles = JSON.parse(readFileSync("config/embed-profiles.json", "utf8"));
  const cv = readFileSync("config/cv.txt", "utf8");

  const raw = await prisma.job.findMany({
    where: { fitScore: { not: null }, duplicateOfId: null },
    select: { id: true, title: true, content: { select: { description: true } }, score: true, fitScore: true, fitBy: true },
  });
  const jobs: JobRow[] = raw.map((j) => ({
    id: j.id,
    title: j.title,
    desc: (j.content?.description ?? "").slice(0, 1500),
    keyword: j.score,
    fit: j.fitScore as number,
    gold: (j.fitBy ?? "").startsWith("qwen27b"),
    nonEnglish: NON_EN.test(j.title),
    tune: hashSplit(j.id),
  }));
  console.log(`${jobs.length} fit-scored jobs (gold ${jobs.filter((j) => j.gold).length}, non-English titles ${jobs.filter((j) => j.nonEnglish).length}, tune ${jobs.filter((j) => j.tune).length})`);

  // Query texts per strategy (strategy -> list of query strings; sim = max over list)
  const queryTexts: Record<string, string[]> = {
    cv: [cv],
    facets: profiles.facets,
    ads: profiles.pseudoAds,
    mix: [...profiles.facets, ...profiles.pseudoAds],
  };

  const results: { model: string; strategy: string; variant: string; slice: string; m: Metrics }[] = [];

  for (const model of MODELS) {
    console.log(`\n=== ${model} ===`);
    // Job vectors, cached per model+variant
    const jobVecs: Record<string, Vec[]> = {};
    for (const variant of VARIANTS) {
      const cachePath = join(CACHE_DIR, `${model.replace(/[:/]/g, "_")}_${variant}.json`);
      if (existsSync(cachePath)) {
        const cached = JSON.parse(readFileSync(cachePath, "utf8"));
        if (cached.ids.length === jobs.length && cached.ids[0] === jobs[0].id) {
          jobVecs[variant] = cached.vecs;
          console.log(`  ${variant}: cache hit (${cached.ids.length})`);
          continue;
        }
      }
      const texts = jobs.map((j) => (variant === "t" ? j.title : `${j.title}\n${j.desc}`));
      const t0 = Date.now();
      const vecs = (await embedAll(model, texts, `${model}/${variant}`)).map(norm);
      console.log(`  ${variant}: embedded ${texts.length} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
      writeFileSync(cachePath, JSON.stringify({ ids: jobs.map((j) => j.id), vecs }));
      jobVecs[variant] = vecs;
    }
    // Query vectors (cheap, never cached)
    const qVecs: Record<string, Vec[]> = {};
    for (const s of STRATEGIES) qVecs[s] = (await embedAll(model, queryTexts[s], `${model}/q-${s}`)).map(norm);

    for (const variant of VARIANTS) {
      for (const s of STRATEGIES) {
        const sims = jobVecs[variant].map((jv) => Math.max(...qVecs[s].map((qv) => dot(jv, qv))));
        const rows = jobs.map((j, i) => ({ ...j, sim: sims[i] }));
        for (const [slice, filter] of [
          ["tune", (r: (typeof rows)[number]) => r.tune],
          ["confirm", (r: (typeof rows)[number]) => !r.tune],
          ["gold", (r: (typeof rows)[number]) => r.gold],
          ["nonEN", (r: (typeof rows)[number]) => r.nonEnglish],
        ] as const) {
          results.push({ model, strategy: s, variant, slice, m: metrics(rows.filter(filter)) });
        }
      }
    }
  }

  // Keyword baseline on the same slices
  for (const [slice, filter] of [
    ["tune", (r: JobRow) => r.tune],
    ["confirm", (r: JobRow) => !r.tune],
    ["gold", (r: JobRow) => r.gold],
    ["nonEN", (r: JobRow) => r.nonEnglish],
  ] as const) {
    const rows = jobs.filter(filter).map((j) => ({ sim: j.keyword, fit: j.fit }));
    results.push({ model: "KEYWORD-BASELINE", strategy: "-", variant: "-", slice, m: metrics(rows) });
  }

  // Report: rank configs by tune-slice p100, show all slices for each
  const lines: string[] = ["# Embedding bake-off results", "", `${jobs.length} fit-scored jobs; frozen queries (config/embed-profiles.json)`, ""];
  const byConfig = new Map<string, typeof results>();
  for (const r of results) {
    const key = `${r.model} | ${r.strategy} | ${r.variant}`;
    if (!byConfig.has(key)) byConfig.set(key, []);
    byConfig.get(key)!.push(r);
  }
  const ranked = [...byConfig.entries()].sort((a, b) => {
    const pa = a[1].find((r) => r.slice === "tune")!.m.p100;
    const pb = b[1].find((r) => r.slice === "tune")!.m.p100;
    return pb - pa;
  });
  lines.push("| config | tune p@100 | confirm p@100 | confirm rho | confirm gemRec | gold p@100 | nonEN p@100 |");
  lines.push("|---|---|---|---|---|---|---|");
  for (const [key, rs] of ranked) {
    const g = (slice: string) => rs.find((r) => r.slice === slice)!.m;
    lines.push(
      `| ${key} | ${g("tune").p100.toFixed(3)} | ${g("confirm").p100.toFixed(3)} | ${g("confirm").rho.toFixed(3)} | ${g("confirm").gemRecall.toFixed(3)} | ${g("gold").p100.toFixed(3)} | ${g("nonEN").p100.toFixed(3)} |`,
    );
  }
  const report = lines.join("\n");
  writeFileSync("embed-eval-results.md", report);
  console.log("\n" + report);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
