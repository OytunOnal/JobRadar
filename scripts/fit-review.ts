// Deep second-pass fit review on the LOCAL 27B model. The 8B/cloud first pass
// is a fast triage and reads optimistic; the 27B pass catches hidden blockers
// (location logistics, language, seniority) on the jobs that actually matter.
// Reviews fitScore >= 40, highest first — aligned with the "possible"
// verdict floor (and the keyword gate's 40), so lower-band pre-scores get
// their 27B look too (the 70+ apply list before the 40-69
// maybes), overwrites the fit fields, stamps fitBy so reruns skip reviewed
// rows, and logs every old->new delta to fit-review.log with a big-drop
// summary at the end.
//
//   npm run fit:review
//
// Ollama-only by construction: the env overrides below beat .env, so the
// clouds stay free for whatever else is running tonight.

process.env.LLM_DISABLE = "anthropic,cerebras,groq,gemini,deepseek";

import { andWhere, openWhere } from "../src/lib/pool";
process.env.OLLAMA_MODEL = process.env.REVIEW_MODEL || "qwen3.8:27b";

import { verdictFields, analyzeFit } from "../src/lib/fit";
import { prisma } from "../src/lib/db";
import { backfill } from "../src/lib/backfill";

const MARK = "qwen27b-review";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --visa-only: restrict the upgrade pass to visa-positive rows — the 8B era's
// wave-1 was deliberately visa-first, so the unreliable "pre" pool is
// CONCENTRATED exactly in the visa filter the user reads.
const VISA_ONLY = process.argv.includes("--visa-only");
// openWhere, not a hand-written copy of it. The copy omitted `disqualified`,
// so this pass was spending 27B minutes on postings the keyword gates had
// already rejected — they can never reach the radar, whatever the verdict.
export const reviewWhere = andWhere(
  openWhere(),
  { fitScore: { gte: 40 }, fitBy: null },
  VISA_ONLY ? { OR: [{ sponsorReg: true }, { visa: "yes" }] } : null,
);

export async function main() {
  const drops: string[] = [];

  await backfill("fit-review", { gpu: "manual/review" }, async (run) => {
    const total = await prisma.job.count({ where: reviewWhere });
    run.log(`=== fit:review (${process.env.OLLAMA_MODEL}) — kuyrukta ${total} ilan (fit>=40, incelenmemiş${VISA_ONLY ? ", SADECE VISA-POZITIF" : ""}) ===`);

    // Self-consuming: verdictFields stamps fitBy, which is what `fitBy: null`
    // excludes. Safe without a cursor because the runner stops a round that
    // consumed nothing.
    while (run.round()) {
      const batch = await prisma.job.findMany({
        include: { content: { select: { description: true } } },
        where: reviewWhere,
        // Highest fit first across the whole (visa-only) set — an explicit
        // "sponsorship offered" 85 must not wait behind a register-matched 45;
        // sponsorReg only breaks ties.
        orderBy: [{ fitScore: "desc" }, { sponsorReg: "desc" }, { score: "desc" }],
        take: 10,
      });
      if (batch.length === 0) return run.drained();

      for (const j of batch) {
        if (run.exhausted()) break;
        try {
          const fit = await analyzeFit({ ...j, description: j.content?.description ?? j.title, visaTier: j.visaTier, seniorityLevel: j.seniorityLevel, langReq: j.langReq });
          if (!fit) { run.failed(); continue; }
          const delta = fit.fitScore - (j.fitScore ?? 0);
          await prisma.job.update({ where: { id: j.id }, data: verdictFields(fit, MARK, j) });
          run.did();
          const line = `${j.company.slice(0, 26)} | ${j.title.slice(0, 34)} | ${j.fitScore} → ${fit.fitScore} (${fit.verdict})`;
          run.log(`  ${run.done}/${total} ${line}`);
          if (delta <= -20) drops.push(line);
        } catch (e) {
          run.failed(e);
        }
        await sleep(Number(process.env.FIT_SLEEP_MS ?? 500));
      }
    }
  });

  if (drops.length > 0) {
    console.log(`BÜYÜK DÜŞÜŞLER (${drops.length} ilan, -20 ve altı):`);
    for (const d of drops) console.log(`  ▼ ${d}`);
  } else {
    console.log("Büyük düşüş yok — ilk geçiş sağlammış.");
  }
}

// The review runs only when this file is the entry point. It also mutates
// process.env above, which is a second reason importing it must not be casual.
const isEntryPoint = process.argv[1]?.replace(/\\/g, "/").endsWith("fit-review.ts");
if (isEntryPoint) await main();
