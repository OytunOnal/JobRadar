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

import { verdictFields, analyzeFit } from "../../src/lib/llm/fit";
import { prisma } from "../../src/lib/db";
import { backfill } from "../../src/lib/queue/backfill";

const LOCATION_TERMS = [
  "locat", "reloc", "izmir", "turkey", "based in", "on-site presence",
  "logistic", "time zone", "timezone", "geograph", "residence", "must be in",
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function main() {
 await backfill("fit-rereview", { gpu: "manual/rereview" }, async (run) => {
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
  run.log(`=== fit:rereview (mobility-aware prompt) — ${targets.length}/${reviewed.length} incelemede konum gerekçesi var ===`);

  let raised = 0;
  // A fixed list, walked once — this queue is derived from prior LLM prose, so
  // there is nothing for a re-query to consume. round() still bounds it.
  for (const t of targets) {
    if (run.exhausted()) return;
    const j = await prisma.job.findUnique({ where: { id: t.id }, include: { content: { select: { description: true } } } });
    if (!j) { run.skip(); continue; }
    try {
      const fit = await analyzeFit({ ...j, description: j.content?.description ?? j.title });
      if (!fit) { run.failed(); continue; }
      const delta = fit.fitScore - (j.fitScore ?? 0);
      await prisma.job.update({ where: { id: j.id }, data: verdictFields(fit, "qwen27b-review2", j) });
      run.did();
      if (delta >= 15) raised++;
      run.log(`  ${run.done}/${targets.length} ${j.company.slice(0, 24)} | ${j.title.slice(0, 32)} | ${j.fitScore} → ${fit.fitScore} (${fit.verdict})`);
    } catch (e) {
      run.failed(e);
    }
    await sleep(500);
  }
  run.drained();
  run.log(`${raised} ilan +15 puan ve üzeri yükseldi`);
 });
}

// The re-review runs only when this file is the entry point. It also mutates
// process.env above, so importing it must not be casual.
const isEntryPoint = process.argv[1]?.replace(/\\/g, "/").endsWith("fit-rereview.ts");
if (isEntryPoint) await main();
