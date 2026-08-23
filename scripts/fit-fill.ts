import { analyzeFit, FIT_PROMPT_VERSION } from "../src/lib/fit";
import { prisma } from "../src/lib/db";
import { acquireGpu, beatGpu, gpuBusyMessage, releaseGpu } from "../src/lib/gpu-lock";
import { blendOrder, cosine, cvVector, fromBuffer } from "../src/lib/embed";
import { extractFacts, EXTRACTOR_VERSION } from "../src/lib/facts";
import { applyFactsToJob } from "../src/lib/visa-write";
import { levelBlocked, type SeniorityLevel } from "../src/lib/seniority";
import { profile, seniorityFor } from "../src/lib/profile";

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


// Refuse rather than compete: two processes alternating between the 27B and
// the embedder spend their time reloading 17.7 GB of weights, not working.
{
  const busy = gpuBusyMessage();
  if (busy) { log(busy); await prisma.$disconnect(); process.exit(0); }
  if (process.env.JOBRADAR_GPU_DELEGATED !== "1") acquireGpu("manual/fit");
  if (process.env.JOBRADAR_GPU_DELEGATED !== "1") process.on("exit", releaseGpu);
  setInterval(beatGpu, 20_000).unref();
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

// Facts we already extracted can rule a posting out before the 27B ever
// reads it: a talent-pool ad with no real opening, a language the candidate
// does not work in, a level the track avoids. These are NOT dropped — the
// store-all rule holds and a profile change can revive them — but they go to
// the very back of the queue, behind even the postings that refuse visas.
// Judging one of these costs a minute stolen from a live option.
//
// Note the split this keeps: facts DETECT (ghost wording, a required
// language, a stated level), the profile JUDGES (whether that language or
// level is a barrier for THIS person). Nothing here is hardcoded to one CV.
function factsRuleOut(f: { ghostRisk: boolean; langReq: string | null; seniorityLevel: string | null } | null, track: string | null): boolean {
  if (!f) return false;
  if (f.ghostRisk) return true;
  const needed = (f.langReq ?? "").split(",").filter(Boolean);
  if (needed.some((c) => !profile.languages.includes(c))) return true;
  const level = (f.seniorityLevel ?? "unknown") as SeniorityLevel;
  return level !== "unknown" && levelBlocked(level, seniorityFor(track ?? undefined).avoid);
}

async function buildQueue(): Promise<string[]> {
  const candidates = await prisma.job.findMany({
    where: { ...where, id: { notIn: skipped } },
    select: {
      id: true, score: true, visaTier: true, track: true,
      vector: { select: { vector: true } },
      facts: { select: { ghostRisk: true, langReq: true, seniorityLevel: true } },
    },
  });
  // Tier order by CERTAINTY of the sponsorship route, then the measured
  // keyword/embedding blend inside each tier. Postings that explicitly refuse
  // sponsorship go LAST: for a candidate who needs it they are dead ends, and
  // GPU minutes spent there are minutes stolen from live options. ("not-needed"
  // rides at the top with yes — no barrier at all.)
  const RANK: Record<string, number> = { "not-needed": 0, yes: 0, maybe: 1, unknown: 2, no: 3 };
  const scored = candidates.map((c) => ({
    id: c.id,
    score: c.score,
    // Tier 4 is the facts-ruled-out lane: last in line, still in line.
    rank: factsRuleOut(c.facts, c.track) ? 4 : RANK[c.visaTier] ?? 2,
    sim: cv && c.vector ? cosine(fromBuffer(c.vector.vector), cv) : null,
  }));
  return [0, 1, 2, 3, 4].flatMap((r) => blendOrder(scored.filter((s) => s.rank === r))).map((s) => s.id);
}

const RESNAPSHOT = 100;
let queue = await buildQueue();
log(`=== fit:fill ${WIDE ? "wave-2 (geniş)" : "wave-1 (visa-pozitif)"} — kuyrukta ${queue.length} ilan (harmanlı sıra${cv ? "" : " YOK"}, ${RESNAPSHOT} analizde bir tazelenir) ===`);
const total = queue.length;

let done = 0;
let failStreak = 0;
let factsDone = 0;
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
    include: {
      content: { select: { description: true } },
      facts: { select: { extractorVersion: true } },
    },
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
      // Extract the posting's facts FIRST, and only for a posting we are
      // about to judge. Running facts over the whole pool would be 218 GPU
      // hours for 78k rows, most of which will never be judged at all; doing
      // it here costs ~12s on top of a ~50s judgment and nothing on the rows
      // we never reach. The judgment needs it: visa tier, language and level
      // reach the prompt as structured lines, not as prose to be re-derived.
      let job = j;
      if (!j.facts || j.facts.extractorVersion !== EXTRACTOR_VERSION) {
        const facts = await extractFacts({ title: j.title, company: j.company, description: desc });
        if (facts) {
          await applyFactsToJob(j.id, facts);
          const fresh = await prisma.job.findUnique({
            where: { id: j.id },
            select: { visaTier: true, seniorityLevel: true, langReq: true },
          });
          if (fresh) job = { ...j, ...fresh };
          factsDone++;
        }
      }
      const fit = await analyzeFit({ ...job, description: desc, visaTier: job.visaTier, seniorityLevel: job.seniorityLevel, langReq: job.langReq });
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
            ...(fit.category === "NO_VISA" ? { visa: "no", visaBy: "llm" } : {}),
            judgments: {
              create: {
                model: "qwen27b", promptVersion: FIT_PROMPT_VERSION, fitScore: fit.fitScore,
                verdict: fit.verdict, category: fit.category, seniorityLevel: j.seniorityLevel,
                ghostRisk: fit.ghostRisk, comment: fit.comment, at: new Date(),
              },
            },
          },
        });
        done++;
        sinceSnapshot++;
        if (done % 25 === 0) log(`  ${done}/${total} analiz edildi, ${factsDone} çıkarım (son: ${j.company.slice(0, 24)} — ${fit.fitScore})`);
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

log(`=== Bitti: ${done} ilan analiz edildi, ${factsDone} tanesi için gerçekler de çıkarıldı ===`);
await prisma.$disconnect();
