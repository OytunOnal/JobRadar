// One-off correction pass: the first 27B review penalized location distance
// ("candidate is in Izmir, role is in London") — wrong premise, the radar
// exists FOR visa-sponsored relocation. The fit prompt now states mobility
// and passes the sponsor-register context; this script re-reviews every
// reviewed job whose verdict leaned on location/relocation reasoning
// (explicit NO_VISA refusals are legitimate and stay).
//
//   npm run fit:rereview

process.env.LLM_DISABLE = "anthropic,cerebras,groq,gemini,deepseek";
process.env.OLLAMA_MODEL = process.env.REVIEW_MODEL || "qwen3.8:27b";

import { appendFileSync } from "node:fs";
import { analyzeFit } from "../src/lib/fit";
import { prisma } from "../src/lib/db";

const LOCATION_TERMS = [
  "locat", "reloc", "izmir", "turkey", "based in", "on-site presence",
  "logistic", "time zone", "timezone", "geograph", "residence", "must be in",
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function log(line: string): void {
  const stamped = `[${new Date().toISOString().slice(0, 19)}] ${line}`;
  console.log(stamped);
  appendFileSync("fit-review.log", stamped + "\n");
}

const reviewed = await prisma.job.findMany({
  where: {
    fitBy: "qwen27b-review",
    delistedAt: null,
    fitCategory: { not: "NO_VISA" }, // explicit refusals are legitimate
  },
  select: { id: true, fitComment: true },
});
const targets = reviewed.filter((j) => {
  const c = (j.fitComment ?? "").toLowerCase();
  return LOCATION_TERMS.some((t) => c.includes(t));
});

log(`=== fit:rereview (mobility-aware prompt) — ${targets.length}/${reviewed.length} incelemede konum gerekçesi var ===`);

let done = 0;
let raised = 0;
let failStreak = 0;
for (const t of targets) {
  const j = await prisma.job.findUnique({ where: { id: t.id }, include: { content: { select: { description: true } } } });
  if (!j) continue;
  try {
    const fit = await analyzeFit({ ...j, description: j.content?.description ?? j.title });
    if (!fit) {
      failStreak++;
    } else {
      failStreak = 0;
      const delta = fit.fitScore - (j.fitScore ?? 0);
      await prisma.job.update({
        where: { id: j.id },
        data: {
          fitScore: fit.fitScore, fitVerdict: fit.verdict, fitComment: fit.comment,
          fitCategory: fit.category, ghostRisk: fit.ghostRisk, fitBy: "qwen27b-review2",
          ...(fit.category === "NO_VISA" ? { visa: "no" } : {}),
        },
      });
      done++;
      if (delta >= 15) raised++;
      log(`  ${done}/${targets.length} ${j.company.slice(0, 24)} | ${j.title.slice(0, 32)} | ${j.fitScore} → ${fit.fitScore} (${fit.verdict})`);
    }
  } catch (e: any) {
    failStreak++;
    log(`  hata (${j.company.slice(0, 20)}): ${String(e.message).slice(0, 90)}`);
  }
  if (failStreak >= 3) {
    log(`Yerel model cevap vermiyor — ${done} yeniden incelemeyle durdu.`);
    break;
  }
  await sleep(500);
}

log(`=== rereview bitti: ${done} ilan, ${raised} tanesi +15 puan ve üzeri yükseldi ===`);
await prisma.$disconnect();
