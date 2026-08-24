import { prisma } from "../../src/lib/db";
import { backfill } from "../../src/lib/queue/backfill";
import { htmlToText, looksLikeHtml, TEXT_VERSION } from "../../src/lib/text/html-text";
import { safeSlice } from "../../src/lib/sources/types";

// Repair descriptions that still carry markup, in place and offline.
//
// Root cause (measured, see lib/html-text.ts): the old stripHtml decoded HTML
// entities AFTER stripping tags, so Greenhouse's HTML-encoded content arrived
// in the database as literal markup — 47-58% of a stored description was
// `<span style=...>` noise. Every consumer paid for it: half of each prompt
// window, every embedding vector, every keyword scan.
//
// No network needed: the markup IS the source text, so the conversion runs
// locally over the pool. Descriptions that were already flattened (structure
// destroyed before storage) cannot be recovered here — desc:fill re-fetches
// those over time.
//
//   npm run repair:descriptions [-- --budget 50000]

const BATCH = 500;

export async function main() {
  let cursor = "";
  let scanned = 0;
  let bytesSaved = 0;

  await backfill("repair-descriptions", {}, async (run) => {
   run.log("=== description repair (markup -> structured text) ===");
   while (run.round()) {
    const rows = await prisma.jobContent.findMany({
      where: { jobId: { gt: cursor } },
      orderBy: { jobId: "asc" },
      take: BATCH,
      select: { jobId: true, description: true },
    });
    if (rows.length === 0) return run.drained();
    // The cursor advances before any write and regardless of whether anything
    // was repaired, which is why this pager could never spin — unlike the
    // predicate-consuming ones. Kept as it was.
    cursor = rows[rows.length - 1].jobId;
    scanned += rows.length;
    // One transaction per batch, not per row: SQLite fsyncs on commit, and
    // ~360k individual commits is hours of disk sync for minutes of work.
    const writes = [];
    let repairs = 0;
    for (const r of rows) {
      if (!looksLikeHtml(r.description)) continue;
      const clean = safeSlice(htmlToText(r.description), 8000);
      // Guard against a conversion that would gut a posting (malformed markup).
      // max, not min: with min() the bar is a flat 120 characters for anything
      // over 800, so an 8,000-character posting that converts to 200 (2.5%
      // kept) passed the guard and overwrote the original irrecoverably.
      if (clean.length < Math.max(120, r.description.length * 0.15)) continue;
      writes.push(prisma.jobContent.update({
        where: { jobId: r.jobId },
        data: { description: clean, textVersion: TEXT_VERSION },
      }));
      // The vector was built from the markup we just removed.
      writes.push(prisma.jobEmbedding.updateMany({
        where: { jobId: r.jobId }, data: { builtFrom: null },
      }));
      bytesSaved += r.description.length - clean.length;
      repairs++;
    }
    // One transaction per batch, not per row: SQLite fsyncs on commit, and
    // ~360k individual commits is hours of disk sync for minutes of work. It is
    // also all-or-nothing, so a single bad row costs its whole batch — hence
    // the try, which the runner turns into a counted failure rather than a dead
    // process with no record of where it stopped.
    try {
      if (writes.length) await prisma.$transaction(writes);
      run.did(repairs);
    } catch (e) {
      run.failed(e);
    }
    if (scanned % 25000 < BATCH) {
      run.log(`  ${scanned} tarandı, ${run.done} onarıldı, ${(bytesSaved / 1e6).toFixed(1)} MB işaretleme atıldı`);
    }
   }
  });

  console.log(`${scanned} tarandı, ${(bytesSaved / 1e6).toFixed(1)} MB kurtarıldı.`);
  console.log("Sonraki adımlar: npm run rescore (metin değişti), embed yeniden üretimi, fit yeniden yargılama.");
}

// The repair runs only when this file is the entry point.
const isEntryPoint = process.argv[1]?.replace(/\\/g, "/").endsWith("repair-descriptions.ts");
if (isEntryPoint) await main();
