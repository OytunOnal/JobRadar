import { appendFileSync } from "node:fs";
import { prisma } from "../src/lib/db";
import { htmlToText, looksLikeHtml } from "../src/lib/html-text";
import { safeSlice } from "../src/lib/sources/types";

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

const args = process.argv.slice(2);
const bIdx = args.indexOf("--budget");
const BUDGET = bIdx !== -1 ? Number(args[bIdx + 1]) || 1_000_000 : 1_000_000;
const BATCH = 500;

function log(line: string): void {
  const stamped = `[${new Date().toISOString().slice(0, 19)}] ${line}`;
  console.log(stamped);
  appendFileSync("repair-descriptions.log", stamped + "\n");
}

async function main() {
  log("=== description repair (markup -> structured text) ===");
  let cursor = "";
  let scanned = 0;
  let repaired = 0;
  let bytesSaved = 0;
  while (repaired < BUDGET) {
    const rows = await prisma.jobContent.findMany({
      where: { jobId: { gt: cursor } },
      orderBy: { jobId: "asc" },
      take: BATCH,
      select: { jobId: true, description: true },
    });
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1].jobId;
    scanned += rows.length;
    // One transaction per batch, not per row: SQLite fsyncs on commit, and
    // ~360k individual commits is hours of disk sync for minutes of work.
    const writes = [];
    for (const r of rows) {
      if (!looksLikeHtml(r.description)) continue;
      const clean = safeSlice(htmlToText(r.description), 8000);
      // Guard against a conversion that would gut a posting (malformed markup).
      if (clean.length < Math.min(120, r.description.length * 0.15)) continue;
      writes.push(prisma.jobContent.update({ where: { jobId: r.jobId }, data: { description: clean } }));
      bytesSaved += r.description.length - clean.length;
      repaired++;
    }
    if (writes.length) await prisma.$transaction(writes);
    if (scanned % 25000 < BATCH) {
      log(`  ${scanned} tarandı, ${repaired} onarıldı, ${(bytesSaved / 1e6).toFixed(1)} MB işaretleme atıldı`);
    }
  }
  log(`=== Bitti: ${scanned} tarandı, ${repaired} onarıldı, ${(bytesSaved / 1e6).toFixed(1)} MB kurtarıldı ===`);
  log("Sonraki adımlar: npm run rescore (metin değişti), embed yeniden üretimi, fit yeniden yargılama.");
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
