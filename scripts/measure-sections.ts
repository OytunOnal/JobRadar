import { prisma } from "../src/lib/db";
import { parseSections, postingView, type SectionKind } from "../src/lib/sections";
import { trimBoilerplate } from "../src/lib/posting-text";
import { factsUserPrompt } from "../src/lib/facts";

// Does the section parser hold up on the real pool, and what does each view
// actually change? Run before trusting postingView() in the pipeline.
//
//   npm run measure:sections [-- --n 3000]

const args = process.argv.slice(2);
const nIdx = args.indexOf("--n");
const N = nIdx !== -1 ? Number(args[nIdx + 1]) || 3000 : 3000;

async function main() {
  // Sample the population the pipeline actually reads: candidates, not the
  // disqualified archive.
  const rows = await prisma.job.findMany({
    where: { disqualified: false, content: { isNot: null } },
    select: { title: true, content: { select: { description: true } } },
    take: N,
    orderBy: { id: "asc" },
  });

  const kindCount: Record<string, number> = {};
  let structured = 0;
  let hasReq = 0;
  let hasResp = 0;
  const shrink = { fitOld: 0, fitNew: 0, embOld: 0, embNew: 0 };
  let visaInOld = 0, visaInNew = 0, visaAnywhere = 0;
  const VISA = /\b(visa|sponsor\w*|work permit|relocation)\b/i;

  for (const r of rows) {
    const d = r.content!.description;
    const secs = parseSections(d);
    const kinds = new Set<SectionKind>();
    for (const s of secs) { kindCount[s.kind] = (kindCount[s.kind] ?? 0) + 1; kinds.add(s.kind); }
    if (secs.some((s) => s.heading)) structured++;
    if (kinds.has("requirements")) hasReq++;
    if (kinds.has("responsibilities")) hasResp++;

    const fitOld = trimBoilerplate(d).slice(0, 3000);
    const fitNew = postingView(d, "fit");
    const embOld = d.slice(0, 1500);
    const embNew = postingView(d, "embed");
    shrink.fitOld += fitOld.length; shrink.fitNew += fitNew.length;
    shrink.embOld += embOld.length; shrink.embNew += embNew.length;

    // The question that motivated all of this: does the sponsorship sentence
    // survive the trim? Compare old facts prep vs the new facts view.
    if (VISA.test(d)) {
      visaAnywhere++;
      // Measure what the MODEL receives, not what one helper returns: the
      // facts prompt is the sectioned view PLUS the signal-line rescue.
      if (VISA.test(trimBoilerplate(d).slice(0, 1800))) visaInOld++;
      if (VISA.test(factsUserPrompt("t", "c", d))) visaInNew++;
    }
  }

  const pct = (a: number, b: number) => `${((a / b) * 100).toFixed(1)}%`;
  console.log(`=== ${rows.length} aday ilan ===`);
  console.log(`Başlıklı (yapılı) ilan: ${structured} (${pct(structured, rows.length)})`);
  console.log(`  requirements bölümü bulunan: ${pct(hasReq, rows.length)}`);
  console.log(`  responsibilities bölümü bulunan: ${pct(hasResp, rows.length)}`);
  console.log("Bölüm türü dağılımı:", Object.entries(kindCount).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}=${v}`).join(" "));
  console.log(`fit istemi ortalama: ${Math.round(shrink.fitOld / rows.length)} -> ${Math.round(shrink.fitNew / rows.length)} karakter`);
  console.log(`embed metni ortalama: ${Math.round(shrink.embOld / rows.length)} -> ${Math.round(shrink.embNew / rows.length)} karakter`);
  console.log(`Vize cümlesi geçen ${visaAnywhere} ilanda modele ulaşan: eski ${pct(visaInOld, visaAnywhere)} -> yeni ${pct(visaInNew, visaAnywhere)}`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
