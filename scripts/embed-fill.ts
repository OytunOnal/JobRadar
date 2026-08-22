import { appendFileSync } from "node:fs";
import { prisma } from "../src/lib/db";
import { embedTexts, jobEmbedText, toBuffer, EMBED_MODEL } from "../src/lib/embed";

// Embedding backfill: vectors for every job that doesn't have one. Local
// (Ollama), no API cost. Candidates first, disqualified rows after them (the
// rescue lane wants those too). Resumable by nature — the null check IS the
// queue.
//
// Optimized as a 3-stage producer/consumer pipeline so the GPU never idles:
//   fetch(next batch)  ||  embed(current batch on GPU)  ||  write(previous)
// plus batched writes (one INSERT..ON CONFLICT per batch instead of N
// round-trips) and a bigger batch (128 — the 0.6B model has VRAM to spare).
// Measured before: ~16 jobs/s sequential; the pipeline overlaps the DB time
// that used to leave the GPU waiting.
//
//   npm run embed:fill                (whole backlog)
//   npm run embed:fill -- --budget 5000

const args = process.argv.slice(2);
const bIdx = args.indexOf("--budget");
const BUDGET = bIdx !== -1 ? Number(args[bIdx + 1]) || 1_000_000 : 1_000_000;
const BATCH = 128;

function log(line: string): void {
  const stamped = `[${new Date().toISOString().slice(0, 19)}] ${line}`;
  console.log(stamped);
  appendFileSync("embed-fill.log", stamped + "\n");
}

interface Row { id: string; title: string; content: { description: string } | null }

async function fetchBatch(): Promise<Row[]> {
  return prisma.job.findMany({
    where: { vector: null, delistedAt: null, duplicateOfId: null },
    orderBy: [{ disqualified: "asc" }, { score: "desc" }],
    take: BATCH,
    select: { id: true, title: true, content: { select: { description: true } } },
  });
}

// One multi-row statement per batch — SQLite pays the commit cost once, not
// N times. $executeRawUnsafe with placeholders (values parameterized).
async function writeBatch(rows: Row[], vecs: number[][]): Promise<void> {
  const placeholders = rows.map(() => "(?, ?, ?)").join(", ");
  const params: unknown[] = [];
  for (let i = 0; i < rows.length; i++) {
    params.push(rows[i].id, EMBED_MODEL, Buffer.from(toBuffer(vecs[i])));
  }
  await prisma.$executeRawUnsafe(
    `INSERT INTO JobEmbedding (jobId, model, vector) VALUES ${placeholders}
     ON CONFLICT(jobId) DO UPDATE SET model = excluded.model, vector = excluded.vector`,
    ...params,
  );
}

async function main() {
  const total = await prisma.job.count({
    where: { vector: null, delistedAt: null, duplicateOfId: null },
  });
  log(`=== embed:fill (${EMBED_MODEL}, pipelined) — kuyrukta ${total} ilan ===`);

  let done = 0;
  const t0 = Date.now();
  let pendingWrite: Promise<void> = Promise.resolve();
  // Prefetch the first batch; inside the loop the NEXT fetch runs while the
  // GPU embeds the current one, and the write of the current overlaps the
  // next embed. The fetch's `vector: null` queue is self-advancing only after
  // the write lands, so the prefetch may overlap one in-flight batch — the
  // ON CONFLICT upsert makes any overlap harmless.
  let current = await fetchBatch();
  while (done < BUDGET && current.length > 0) {
    const embedP = embedTexts(current.map((j) => jobEmbedText(j.title, j.content?.description ?? null)));
    // Wait for the previous write BEFORE fetching the next batch, so the
    // null-queue has advanced and we don't refetch the same rows.
    await pendingWrite;
    const nextP = fetchBatch();
    const vecs = await embedP;
    const rows = current;
    pendingWrite = writeBatch(rows, vecs);
    done += rows.length;
    if (done % (BATCH * 10) < BATCH) {
      const rate = done / ((Date.now() - t0) / 1000);
      log(`  ${done}/${Math.min(total, BUDGET)} embed edildi (${rate.toFixed(0)}/sn)`);
    }
    current = await nextP;
  }
  await pendingWrite;
  log(`=== Bitti: ${done} ilan embed edildi (${(done / ((Date.now() - t0) / 1000)).toFixed(0)}/sn ort) ===`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
