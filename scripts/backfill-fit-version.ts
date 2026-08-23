import { prisma } from "../src/lib/db";

// One-off: teach existing verdicts which system produced them.
//
// Job.fitPromptVersion is new, so every judged row reads as "unknown version"
// — which the queue would treat identically to "never judged". That is nearly
// right (all 5,622 verdicts predate v7) but it throws away a real
// distinction: LlmJudgmentHistory has recorded the prompt version all along.
// Copy the latest one onto the job so "what changed between versions" stays a
// query, not an archaeology exercise.
const rows: any[] = await prisma.$queryRawUnsafe(`
  SELECT j.id, (
    SELECT h.promptVersion FROM LlmJudgmentHistory h
    WHERE h.jobId = j.id ORDER BY h.at DESC LIMIT 1
  ) v
  FROM Job j WHERE j.fitScore IS NOT NULL AND j.fitPromptVersion IS NULL`);
console.log(`${rows.length.toLocaleString("tr")} yargılanmış ilan damgalanacak`);
let n = 0;
for (let i = 0; i < rows.length; i += 500) {
  const slice = rows.slice(i, i + 500).filter((r) => r.v);
  if (!slice.length) continue;
  await prisma.$transaction(slice.map((r) =>
    prisma.job.update({ where: { id: r.id }, data: { fitPromptVersion: String(r.v) } })));
  n += slice.length;
}
console.log(`${n.toLocaleString("tr")} damgalandı`);
const left = await prisma.job.count({ where: { fitScore: { not: null }, fitPromptVersion: null } });
console.log(`geçmişi olmadığı için damgasız kalan: ${left.toLocaleString("tr")}`);
await prisma.$disconnect();
