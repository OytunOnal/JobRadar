import { prisma } from "../../src/lib/db";
import { backfill } from "../../src/lib/queue/backfill";
import { extractFacts, factsQueueWhere, EXTRACTOR_VERSION } from "../../src/lib/llm/facts";
import { applyFactsToJob } from "../../src/lib/visa/visa-write";
import { andWhere, openWhere } from "../../src/lib/queue/pool";

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

const JUDGED_FIRST = process.argv.includes("--judged-first");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
// The queue predicate lives with the concept (factsQueueWhere in llm/facts.ts
// — version-aware, so improving the extractor re-runs only what it must);
// this script adds only its own run-order option on top.
export const factsWhere = andWhere(
  factsQueueWhere(),
  JUDGED_FIRST ? { fitScore: { not: null } } : null,
);

export async function main() {
  await backfill("facts-fill", { gpu: "manual/facts" }, async (run) => {
    const total = await prisma.job.count({ where: factsWhere });
    run.log(`=== facts:fill (${EXTRACTOR_VERSION}${JUDGED_FIRST ? ", önce yargılanmışlar" : ""}) — kuyrukta ${total} ilan ===`);

    // A self-consuming queue: applyFactsToJob stamps the current extractor
    // version, which is exactly what this predicate excludes. No cursor needed
    // — and no cursor is safe only because the runner notices a round that
    // consumed nothing.
    while (run.round()) {
      const batch = await prisma.job.findMany({
        where: factsWhere,
        orderBy: [{ fitScore: { sort: "desc", nulls: "last" } }, { score: "desc" }],
        take: 20,
        include: { content: { select: { description: true } } },
      });
      if (batch.length === 0) return run.drained();

      for (const j of batch) {
        if (run.exhausted()) break;
        const description = j.content?.description ?? j.title;
        try {
          const facts = await extractFacts({ title: j.title, company: j.company, description });
          // A null answer is the model failing to answer, not a row to skip:
          // three in a row and the run gives up rather than grinding.
          if (!facts) { run.failed(); continue; }
          await applyFactsToJob(j.id, facts);
          run.did();
          if (run.done % 25 === 0) {
            run.log(`  ${run.done}/${total} çıkarıldı (son: ${j.company.slice(0, 22)} — visa ${facts.visaOffered ?? "-"}, ${facts.seniorityLevel})`);
          }
        } catch (e) {
          run.failed(e);
        }
        await sleep(Number(process.env.FACTS_SLEEP_MS ?? 0));
      }
    }
  });
}

// The backfill runs only when this file is the entry point.
const isEntryPoint = process.argv[1]?.replace(/\\/g, "/").endsWith("facts-fill.ts");
if (isEntryPoint) await main();
