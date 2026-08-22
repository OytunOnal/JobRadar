import { analyzeFit, FIT_PROMPT_VERSION } from "../src/lib/fit";
import { prisma } from "../src/lib/db";
import { blendOrder, cosine, cvVector, fromBuffer } from "../src/lib/embed";

// Paced fit-analysis backlog filler over the FREE provider chain. Wave 1 (the
// user's pick): score > 50 AND visa-positive — the company is in a public
// sponsor register OR the posting itself says sponsorship. Most-applyable
// first: sponsor-registered, then score, then recency.
//
// Self-resuming (works off fitScore=null), stops gracefully when the whole
// provider chain is exhausted (3 consecutive all-provider failures), logs
// every 25 jobs to fit-fill.log.
//
//   npm run fit:fill                  (wave 1)
//   npm run fit:fill -- --wide        (wave 2: score > 50, target-or-remote, fresh)
//   npm run fit:fill -- --limit 500

import { appendFileSync } from "node:fs";

const args = process.argv.slice(2);
const WIDE = args.includes("--wide");
const limIdx = args.indexOf("--limit");
const LIMIT = limIdx !== -1 ? Number(args[limIdx + 1]) || 100000 : 100000;
// --wait N: on chain exhaustion, sleep N minutes and retry instead of exiting
// (free quotas refill on rolling/daily windows — an overnight run rides them).
const waitIdx = args.indexOf("--wait");
const WAIT_MIN = waitIdx !== -1 ? Number(args[waitIdx + 1]) || 30 : 0;
const TARGETS = ["de", "nl", "es", "ch", "dk", "se", "be", "pl", "fr", "pt", "at", "ie", "gb", "no", "fi"];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function log(line: string): void {
  const stamped = `[${new Date().toISOString().slice(0, 19)}] ${line}`;
  console.log(stamped);
  appendFileSync("fit-fill.log", stamped + "\n");
}

const freshCut = new Date(Date.now() - 45 * 86_400_000);
const where = WIDE
  ? {
      fitScore: null, delistedAt: null, duplicateOfId: null, disqualified: false,
      status: { in: ["new", "interested"] },
      // 40+: a single title hit scores 40, and title-only sources cap
      // around it — the 50 bar was hiding half the eligible pool.
      score: { gte: 40 },
      postedAt: { gte: freshCut },
      OR: [{ country: { in: TARGETS } }, { workMode: "remote" }],
    }
  : {
      fitScore: null, delistedAt: null, duplicateOfId: null, disqualified: false,
      status: { in: ["new", "interested"] },
      score: { gt: 50 },
      OR: [{ sponsorReg: true }, { visa: "yes" }],
    };

// Blended queue: visa-positive tier first, then the measured 40/60
// keyword/embedding rank blend (see src/lib/embed.ts). Jobs without a vector
// ride their keyword rank. The queue is REBUILT every RESNAPSHOT analyses:
// during a big pull, visa-positive jobs arriving mid-run must jump ahead of
// an old snapshot's tail, not wait for the next process restart.
let cv: number[] | null = null;
try {
  cv = await cvVector();
} catch {
  log("(embedding modeli erişilemez — kuyruk salt keyword sırasıyla)");
}

const skipped: string[] = []; // title-only rows wait for desc:fill

async function buildQueue(): Promise<string[]> {
  const candidates = await prisma.job.findMany({
    where: { ...where, id: { notIn: skipped } },
    select: { id: true, score: true, sponsorReg: true, visa: true, vector: { select: { vector: true } } },
  });
  const scored = candidates.map((c) => ({
    id: c.id,
    score: c.score,
    visaTier: c.sponsorReg || c.visa === "yes" ? 1 : 0,
    sim: cv && c.vector ? cosine(fromBuffer(c.vector.vector), cv) : null,
  }));
  return [
    ...blendOrder(scored.filter((s) => s.visaTier === 1)),
    ...blendOrder(scored.filter((s) => s.visaTier === 0)),
  ].map((s) => s.id);
}

const RESNAPSHOT = 100;
let queue = await buildQueue();
log(`=== fit:fill ${WIDE ? "wave-2 (geniş)" : "wave-1 (visa-pozitif)"} — kuyrukta ${queue.length} ilan (harmanlı sıra${cv ? "" : " YOK"}, ${RESNAPSHOT} analizde bir tazelenir) ===`);
const total = queue.length;

let done = 0;
let failStreak = 0;
let cursor = 0;
let sinceSnapshot = 0;
while (done < LIMIT) {
  if (sinceSnapshot >= RESNAPSHOT || cursor >= queue.length) {
    queue = await buildQueue();
    cursor = 0;
    sinceSnapshot = 0;
    if (queue.length === 0) break;
    log(`  kuyruk tazelendi: ${queue.length} ilan`);
  }
  const ids = queue.slice(cursor, cursor + 25);
  cursor += ids.length;
  const rows = await prisma.job.findMany({
    where: { id: { in: ids }, fitScore: null },
    include: { content: { select: { description: true } } },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const batch = ids.map((id) => byId.get(id)).filter((r): r is NonNullable<typeof r> => Boolean(r));
  if (batch.length === 0) continue;
  for (const j of batch) {
    if (done >= LIMIT) break;
    // Title-only rows have nothing for the model to read — desc:fill feeds
    // them; skip in-memory only, so they re-enter once a description lands.
    const desc = j.content?.description ?? "";
    if (desc.length < j.title.length + 60) {
      skipped.push(j.id);
      continue;
    }
    try {
      const fit = await analyzeFit({ ...j, description: desc });
      if (!fit) {
        failStreak++;
      } else {
        failStreak = 0;
        await prisma.job.update({
          where: { id: j.id },
          data: {
            fitScore: fit.fitScore, fitVerdict: fit.verdict, fitComment: fit.comment,
            fitCategory: fit.category, ghostRisk: fit.ghostRisk,
            // Single-tier regime (user decision 2026-08-21): the 27B judges
            // directly — no 8B triage, no separate review pass to await.
            fitBy: "qwen27b",
            // The LLM's level verdict outranks the regex detector.
            ...(fit.seniorityLevel && fit.seniorityLevel !== "unknown"
              ? { seniorityLevel: fit.seniorityLevel, seniorityBy: "llm" } : {}),
            ...(fit.category === "NO_VISA" ? { visa: "no" } : {}),
            judgments: {
              create: {
                model: "qwen27b", promptVersion: FIT_PROMPT_VERSION, fitScore: fit.fitScore,
                verdict: fit.verdict, category: fit.category, seniorityLevel: fit.seniorityLevel,
                ghostRisk: fit.ghostRisk, comment: fit.comment, at: new Date(),
              },
            },
          },
        });
        done++;
        sinceSnapshot++;
        if (done % 25 === 0) log(`  ${done}/${total} analiz edildi (son: ${j.company.slice(0, 24)} — ${fit.fitScore})`);
      }
    } catch (e: any) {
      failStreak++;
      log(`  hata (${j.company.slice(0, 20)}): ${String(e.message).slice(0, 90)}`);
    }
    if (failStreak >= 3) {
      if (WAIT_MIN > 0) {
        log(`Zincir tükendi — ${WAIT_MIN} dk uyuyup tekrar denenecek (şu ana dek ${done} analiz).`);
        await sleep(WAIT_MIN * 60_000);
        failStreak = 0;
      } else {
        log(`Zincir tükendi görünüyor (3 ardışık başarısızlık) — ${done} analizle zarifçe duruldu. Sonra tekrar koş.`);
        await prisma.$disconnect();
        process.exit(0);
      }
    }
    // Politeness pacing is for cloud quotas; a local Ollama needs none.
    await sleep(Number(process.env.FIT_SLEEP_MS ?? 1_500));
  }
}

log(`=== Bitti: ${done} ilan analiz edildi ===`);
await prisma.$disconnect();
