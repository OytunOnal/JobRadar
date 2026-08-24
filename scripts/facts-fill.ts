import { appendFileSync } from "node:fs";
import { prisma } from "../src/lib/db";
import { acquireGpu, beatGpu, gpuBusyMessage, releaseGpu } from "../src/lib/gpu-lock";
import { extractFacts, EXTRACTOR_VERSION } from "../src/lib/facts";
import { applyFactsToJob } from "../src/lib/visa-write";
import { andWhere, openWhere } from "../src/lib/pool";

// Refuse rather than compete: two processes alternating between the 27B and
// the embedder spend their time reloading 17.7 GB of weights, not working.
{
  const busy = gpuBusyMessage();
  if (busy) { log(busy); await prisma.$disconnect(); process.exit(0); }
  if (process.env.JOBRADAR_GPU_DELEGATED !== "1") acquireGpu("manual/facts");
  if (process.env.JOBRADAR_GPU_DELEGATED !== "1") process.on("exit", releaseGpu);
  setInterval(beatGpu, 20_000).unref();
}


// Posting-fact extraction worker: the cheap CV-independent stage that feeds
// the visa tier, the seniority badge and the language flag. Runs ahead of the
// fit judge (whose queue order depends on the visa tier it produces).
//
//   npm run facts:fill                     (whole queue population)
//   npm run facts:fill -- --judged-first   (backfill jobs already fit-judged)
//   npm run facts:fill -- --budget 500
//
// Self-resuming: the queue is "no PostingFacts row at the current extractor
// version". Priority: already-judged jobs first when asked (their tiers are
// what the user is looking at right now), then highest keyword score.

const args = process.argv.slice(2);
const bIdx = args.indexOf("--budget");
const BUDGET = bIdx !== -1 ? Number(args[bIdx + 1]) || 1_000_000 : 1_000_000;
const JUDGED_FIRST = args.includes("--judged-first");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function log(line: string): void {
  const stamped = `[${new Date().toISOString().slice(0, 19)}] ${line}`;
  console.log(stamped);
  appendFileSync("facts-fill.log", stamped + "\n");
}

// The open pool above the score gate. Written out by hand here until pool.ts
// existed, which is how it came to carry its own copy of the four eligibility
// columns.
//
// NOT judgeTargetWhere, though facts exist mainly to feed the judging queue:
// applyFactsToJob also writes visa evidence, and the visa tier is a badge the
// radar shows on postings the judge will never reach. Narrowing this to judge
// targets measured 71,724 -> 26,134, and the 45,590 difference is postings that
// would silently stop getting their sponsorship evidence.
//
// The 40 is therefore still written twice, here and in judgeTargetWhere. That
// is deliberate: they are two different questions that happen to share a
// number, and merging them is what would couple this queue to the judge's
// policy.
const where = andWhere(
  openWhere(),
  { score: { gte: 40 } },
  // Queue = "no facts yet, or facts from an older extractor". Version-aware
  // like the keyword rescore: improving the extractor re-runs only what it
  // must, and the improvement reaches existing rows without a manual sweep.
  { OR: [{ facts: { is: null } }, { facts: { extractorVersion: { not: EXTRACTOR_VERSION } } }] },
  JUDGED_FIRST ? { fitScore: { not: null } } : null,
);

async function main() {
  const total = await prisma.job.count({ where });
  log(`=== facts:fill (${EXTRACTOR_VERSION}${JUDGED_FIRST ? ", önce yargılanmışlar" : ""}) — kuyrukta ${total} ilan ===`);

  let done = 0;
  let failStreak = 0;
  while (done < BUDGET) {
    const batch = await prisma.job.findMany({
      where,
      orderBy: [{ fitScore: { sort: "desc", nulls: "last" } }, { score: "desc" }],
      take: 20,
      include: { content: { select: { description: true } } },
    });
    if (batch.length === 0) break;
    for (const j of batch) {
      if (done >= BUDGET) break;
      const description = j.content?.description ?? j.title;
      try {
        const facts = await extractFacts({ title: j.title, company: j.company, description });
        if (!facts) {
          failStreak++;
        } else {
          failStreak = 0;
          await applyFactsToJob(j.id, facts);
          done++;
          if (done % 25 === 0) log(`  ${done}/${total} çıkarıldı (son: ${j.company.slice(0, 22)} — visa ${facts.visaOffered ?? "-"}, ${facts.seniorityLevel})`);
        }
      } catch (e: any) {
        failStreak++;
        log(`  hata (${j.company.slice(0, 20)}): ${String(e.message).slice(0, 90)}`);
      }
      if (failStreak >= 3) {
        log(`Model cevap vermiyor (3 ardışık hata) — ${done} çıkarımla duruldu.`);
        await prisma.$disconnect();
        process.exit(0);
      }
      await sleep(Number(process.env.FACTS_SLEEP_MS ?? 0));
    }
  }
  log(`=== Bitti: ${done} ilan için gerçekler çıkarıldı ===`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
