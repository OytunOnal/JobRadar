import { appendFileSync } from "node:fs";
import { prisma } from "../src/lib/db";
import { embedTexts, jobEmbedText, toBuffer, EMBED_MODEL } from "../src/lib/embed";

// Embedding backfill: vectors for every job that doesn't have one. Local
// (Ollama), no API cost; ~50-100 jobs/s on the 0.6b model. Candidates first,
// disqualified rows after them (the rescue lane wants those too). Resumable
// by nature — the null check IS the queue.
//
//   npm run embed:fill                (whole backlog)
//   npm run embed:fill -- --budget 5000

const args = process.argv.slice(2);
const bIdx = args.indexOf("--budget");
const BUDGET = bIdx !== -1 ? Number(args[bIdx + 1]) || 1_000_000 : 1_000_000;
const BATCH = 32;

function log(line: string): void {
  const stamped = `[${new Date().toISOString().slice(0, 19)}] ${line}`;
  console.log(stamped);
  appendFileSync("embed-fill.log", stamped + "\n");
}

async function main() {
  const where = { vector: null, delistedAt: null, duplicateOfId: null } as const;
  const total = await prisma.job.count({ where });
  log(`=== embed:fill (${EMBED_MODEL}) — kuyrukta ${total} ilan ===`);

  let done = 0;
  while (done < BUDGET) {
    const batch = await prisma.job.findMany({
      where,
      orderBy: [{ disqualified: "asc" }, { score: "desc" }],
      take: BATCH,
      select: { id: true, title: true, content: { select: { description: true } } },
    });
    if (batch.length === 0) break;
    const vecs = await embedTexts(batch.map((j) => jobEmbedText(j.title, j.content?.description ?? null)));
    for (let i = 0; i < batch.length; i++) {
      await prisma.jobEmbedding.upsert({
        where: { jobId: batch[i].id },
        update: { model: EMBED_MODEL, vector: toBuffer(vecs[i]) },
        create: { jobId: batch[i].id, model: EMBED_MODEL, vector: toBuffer(vecs[i]) },
      });
    }
    done += batch.length;
    if (done % (BATCH * 25) < BATCH) log(`  ${done}/${Math.min(total, BUDGET)} embed edildi`);
  }
  log(`=== Bitti: ${done} ilan embed edildi ===`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
