import { prisma } from "../../src/lib/db";
import { parseSections } from "../../src/lib/text/sections";

// "Why is the requirements rate still low?" has three possible answers and
// they need very different work:
//
//   1. the posting has no structure at all (data damage — refetch)
//   2. it has headings, but none of them names a requirements block
//      (a) because the posting genuinely has no requirements section
//      (b) because our vocabulary does not know that heading  <- fixable here
//   3. the requirements ARE there under a heading we misfiled
//
// Split the population by those cases and print the evidence for each, so the
// number moves for a reason rather than by regex-fiddling.

const N = Number(process.argv[2]) || 6000;

async function main() {
  const rows = await prisma.job.findMany({
    where: { disqualified: false, content: { isNot: null } },
    select: { source: true, content: { select: { description: true } } },
    take: N,
    orderBy: { id: "asc" },
  });

  let flat = 0, structured = 0, withReq = 0, reqLikeBody = 0;
  const missingHeadings = new Map<string, number>();
  const REQ_BODY = /\b(years? of experience|jahre\w* erfahrung|proficien\w+|experience (with|in)|degree in|bachelor|master'?s|you have|du hast|familiar with)\b/i;

  for (const r of rows) {
    const d = r.content!.description;
    const secs = parseSections(d);
    if (!secs.some((s) => s.heading)) { flat++; continue; }
    structured++;
    if (secs.some((s) => s.kind === "requirements")) { withReq++; continue; }

    // Structured but no requirements section. Does the TEXT read like it has
    // requirements anyway? If yes, we are losing them to an unknown heading.
    if (REQ_BODY.test(d)) {
      reqLikeBody++;
      for (const s of secs) {
        if (s.kind !== "other" || !s.heading) continue;
        if (!REQ_BODY.test(s.body)) continue;
        const k = s.heading.toLowerCase().slice(0, 55);
        missingHeadings.set(k, (missingHeadings.get(k) ?? 0) + 1);
      }
    }
  }

  const pct = (a: number, b: number) => `${((a / b) * 100).toFixed(1)}%`;
  console.log(`=== ${rows.length} aday ===`);
  console.log(`yapısız (veri hasarı): ${flat} (${pct(flat, rows.length)})`);
  console.log(`yapılı: ${structured} (${pct(structured, rows.length)})`);
  console.log(`  requirements bölümü VAR: ${withReq} (yapılıların ${pct(withReq, structured)})`);
  console.log(`  yok ama metin gereksinim gibi okunuyor: ${reqLikeBody} (yapılıların ${pct(reqLikeBody, structured)})`);
  console.log("\nGereksinim içeriği taşıyan ama sınıflanamayan başlıklar:");
  [...missingHeadings].sort((a, b) => b[1] - a[1]).slice(0, 30)
    .forEach(([h, n]) => console.log(String(n).padStart(4), h));
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
