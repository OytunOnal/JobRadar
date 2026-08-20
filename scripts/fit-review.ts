// Deep second-pass fit review on the LOCAL 27B model. The 8B/cloud first pass
// is a fast triage and reads optimistic; the 27B pass catches hidden blockers
// (location logistics, language, seniority) on the jobs that actually matter.
// Reviews fitScore >= 50, highest first (the 70+ apply list before the 50-69
// maybes), overwrites the fit fields, stamps fitBy so reruns skip reviewed
// rows, and logs every old->new delta to fit-review.log with a big-drop
// summary at the end.
//
//   npm run fit:review
//
// Ollama-only by construction: the env overrides below beat .env, so the
// clouds stay free for whatever else is running tonight.

process.env.LLM_DISABLE = "anthropic,cerebras,groq,gemini,deepseek";
process.env.OLLAMA_MODEL = process.env.REVIEW_MODEL || "qwen3.8:27b";

import { appendFileSync } from "node:fs";
import { analyzeFit } from "../src/lib/fit";
import { prisma } from "../src/lib/db";

const MARK = "qwen27b-review";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function log(line: string): void {
  const stamped = `[${new Date().toISOString().slice(0, 19)}] ${line}`;
  console.log(stamped);
  appendFileSync("fit-review.log", stamped + "\n");
}

const where = {
  fitScore: { gte: 50 },
  fitBy: null,
  delistedAt: null,
  duplicateOfId: null,
  status: { in: ["new", "interested"] },
};

const total = await prisma.job.count({ where });
log(`=== fit:review (${process.env.OLLAMA_MODEL}) — kuyrukta ${total} ilan (fit>=50, incelenmemiş) ===`);

let done = 0;
let failStreak = 0;
const drops: string[] = [];

while (true) {
  const batch = await prisma.job.findMany({
    where,
    orderBy: [{ fitScore: "desc" }, { score: "desc" }],
    take: 10,
  });
  if (batch.length === 0) break;
  for (const j of batch) {
    try {
      const fit = await analyzeFit(j);
      if (!fit) {
        failStreak++;
      } else {
        failStreak = 0;
        const delta = fit.fitScore - (j.fitScore ?? 0);
        await prisma.job.update({
          where: { id: j.id },
          data: {
            fitScore: fit.fitScore, fitVerdict: fit.verdict, fitComment: fit.comment,
            fitCategory: fit.category, ghostRisk: fit.ghostRisk, fitBy: MARK,
            ...(fit.category === "NO_VISA" ? { visa: "no" } : {}),
          },
        });
        done++;
        const line = `${j.company.slice(0, 26)} | ${j.title.slice(0, 34)} | ${j.fitScore} → ${fit.fitScore} (${fit.verdict})`;
        log(`  ${done}/${total} ${line}`);
        if (delta <= -20) drops.push(line);
      }
    } catch (e: any) {
      failStreak++;
      log(`  hata (${j.company.slice(0, 20)}): ${String(e.message).slice(0, 90)}`);
    }
    if (failStreak >= 3) {
      log(`Yerel model cevap vermiyor (3 ardışık başarısızlık) — ${done} incelemeyle durdu.`);
      await prisma.$disconnect();
      process.exit(0);
    }
    await sleep(500);
  }
}

log(`=== Bitti: ${done} ilan incelendi ===`);
if (drops.length > 0) {
  log(`BÜYÜK DÜŞÜŞLER (${drops.length} ilan, -20 ve altı):`);
  for (const d of drops) log(`  ▼ ${d}`);
} else {
  log("Büyük düşüş yok — ilk geçiş sağlammış.");
}
await prisma.$disconnect();
