import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { submitFitBatch, getBatch, fetchResults, type JobForBatch } from "../src/lib/batch";

// Usage:
//   npm run fit:batch            → submit ALL jobs, poll, write results
//   npm run fit:batch collect <id> → just collect an existing batch id
const STATE = "data/last-batch.json";
const POLL_MS = 15000;
const MAX_WAIT_MS = 40 * 60 * 1000;

const prisma = new PrismaClient();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function collect(batchId: string) {
  const started = Date.now();
  while (Date.now() - started < MAX_WAIT_MS) {
    const b = await getBatch(batchId);
    const c = b.counts;
    console.log(`  status=${b.status} processing=${c.processing ?? 0} succeeded=${c.succeeded ?? 0} errored=${c.errored ?? 0}`);
    if (b.status === "ended" && b.resultsUrl) {
      const results = await fetchResults(b.resultsUrl);
      let written = 0;
      for (const r of results) {
        if (!r.fit) continue;
        await prisma.job.update({
          where: { id: r.jobId },
          data: { fitScore: r.fit.fitScore, fitVerdict: r.fit.verdict, fitComment: r.fit.comment },
        }).catch(() => {}); // job may have been removed
        written++;
      }
      console.log(`\n✓ Wrote ${written} fit scores from ${results.length} results.`);
      return;
    }
    await sleep(POLL_MS);
  }
  console.log(`\n⏱ Still running after ${MAX_WAIT_MS / 60000}min. Resume later with: npm run fit:batch collect ${batchId}`);
}

const [, , cmd, argId] = process.argv;

if (cmd === "collect" && argId) {
  await collect(argId);
} else {
  // Fit every not-yet-scored job (skip dismissed ones). Pass --all to re-score
  // the whole board (e.g. after editing your CV in config/user.ts).
  const rescoreAll = process.argv.includes("--all");
  const jobs = await prisma.job.findMany({
    where: { status: { not: "ignored" }, ...(rescoreAll ? {} : { fitScore: null }) },
    select: { id: true, title: true, company: true, location: true, description: true },
  });
  if (jobs.length === 0) {
    console.log("Nothing to score — every job already has a fit. (Use --all to re-score.)");
    await prisma.$disconnect();
    process.exit(0);
  }
  const batchJobs: JobForBatch[] = jobs.map((j) => ({
    id: j.id,
    title: j.title,
    company: j.company,
    location: j.location,
    description: j.description,
  }));
  console.log(`Submitting batch for ${batchJobs.length} jobs (model: claude-haiku-4-5)...`);
  const batchId = await submitFitBatch(batchJobs);
  if (!existsSync("data")) mkdirSync("data");
  writeFileSync(STATE, JSON.stringify({ batchId, submittedCount: batchJobs.length }, null, 2));
  console.log(`Batch id: ${batchId}  (saved to ${STATE})\nPolling...`);
  await collect(batchId);
}

await prisma.$disconnect();
