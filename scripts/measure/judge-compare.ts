import { analyzeFit, FIT_PROMPT_VERSION, type FitResult } from "../../src/lib/llm/fit";
import { EXTRACTOR_VERSION } from "../../src/lib/llm/facts";
import { providerStatus } from "../../src/lib/llm/llm";
import { prisma } from "../../src/lib/db";

// DOES A RENTED / HOSTED JUDGE AGREE WITH THE LOCAL ONE?
//
// The $5 GPU trial is not really a price question -- docs/llm-hosting-cost.md
// already answered that, and answered it against renting. What no document can
// answer is whether a different model REACHES THE SAME VERDICTS, because that
// is a property of our prompt and our postings, not of a leaderboard.
//
// So this re-judges postings the local 27B has ALREADY judged, through a
// provider pinned with LLM_ONLY, and reports agreement rather than quality:
// we have no ground truth, and inventing one would be worse than measuring
// disagreement honestly. A candidate that disagrees on a third of the pool is
// not a drop-in replacement whatever its benchmark scores say.
//
//   LLM_ONLY=endpoint npm run judge:compare -- --limit 30
//
// It NEVER writes a verdict. The rows keep the local judgement; this only
// reads them and asks a second judge the same question.
//
// Two deliberate choices about the sample:
//
//   * Only rows already judged at FIT_PROMPT_VERSION, and whose facts are at
//     EXTRACTOR_VERSION. Otherwise the comparison silently includes a fact
//     extraction the local run never had, and we would be measuring two
//     different prompts.
//   * Spread across the score range, not the top of the queue. Judging thirty
//     near-certain matches measures the easy end and tells us nothing about
//     where a weaker model actually breaks -- the borderline rows are the ones
//     whose verdicts decide what reaches the user.

const args = process.argv.slice(2);
const flag = (name: string, fallback: number): number => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : Number(args[i + 1]) || fallback;
};
const LIMIT = flag("limit", 30);
const TIER: "fast" | "strong" = args.includes("--strong") ? "strong" : "fast";

interface Row {
  id: string;
  title: string;
  company: string;
  location: string | null;
  salaryText: string | null;
  visa: string;
  sponsorReg: boolean;
  track: string | null;
  visaTier: string | null;
  seniorityLevel: string | null;
  langReq: string | null;
  fitScore: number | null;
  fitVerdict: string | null;
  fitCategory: string | null;
  ghostRisk: boolean | null;
  fitBy: string | null;
  description: string;
}

/** Sample the judged pool evenly across the score range. */
async function sample(): Promise<Row[]> {
  const rows = await prisma.job.findMany({
    where: {
      fitScore: { not: null },
      fitPromptVersion: FIT_PROMPT_VERSION,
      facts: { is: { extractorVersion: EXTRACTOR_VERSION } },
    },
    select: {
      id: true, title: true, company: true, location: true, salaryText: true,
      visa: true, sponsorReg: true, track: true, visaTier: true,
      seniorityLevel: true, langReq: true,
      fitScore: true, fitVerdict: true, fitCategory: true, ghostRisk: true, fitBy: true,
      content: { select: { description: true } },
    },
    take: 4000,
  });
  const usable = rows
    .filter((r) => (r.content?.description ?? "").length >= r.title.length + 60)
    .map((r) => ({ ...r, description: r.content!.description! })) as Row[];
  // Even spread over the local score, so the sample carries the borderline
  // band rather than only the confident top.
  usable.sort((a, b) => (a.fitScore ?? 0) - (b.fitScore ?? 0));
  if (usable.length <= LIMIT) return usable;
  const step = usable.length / LIMIT;
  return Array.from({ length: LIMIT }, (_, i) => usable[Math.floor(i * step)]!);
}

const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

async function main(): Promise<void> {
  const only = process.env.LLM_ONLY ?? "";
  const ready = providerStatus().filter((p) => p.ready);
  if (!only) {
    console.error(
      "LLM_ONLY belirtilmedi. Ölçüm sağlayıcıyı sabitlemek zorunda — aksi halde\n" +
      "zincir sessizce ollama'ya düşer ve rapor yerel modeli anlatırken kiralık\n" +
      "olanı anlattığını sanır.\n\n" +
      `  Hazır sağlayıcılar: ${ready.map((p) => `${p.name} (${p.model})`).join(", ") || "yok"}\n` +
      "  Örnek: LLM_ONLY=endpoint npm run judge:compare -- --limit 30",
    );
    process.exitCode = 1;
    return;
  }
  if (!ready.length) {
    console.error(`LLM_ONLY=${only} ama o sağlayıcı hazır değil — .env eksik olabilir.`);
    process.exitCode = 1;
    return;
  }

  const rows = await sample();
  if (!rows.length) {
    console.error("Karşılaştırılacak yargılanmış ilan bulunamadı.");
    process.exitCode = 1;
    return;
  }

  const judge = ready[0]!;
  console.log(`judge:compare — ${rows.length} ilan, hakem: ${judge.name} (${judge.model}), tier: ${TIER}`);
  console.log(`yerel referans: ${FIT_PROMPT_VERSION}\n`);

  const lat: number[] = [];
  const deltas: number[] = [];
  let verdictSame = 0;
  let categorySame = 0;
  let ghostSame = 0;
  let failed = 0;
  const disagreements: string[] = [];
  const startedAt = Date.now();

  for (const [i, r] of rows.entries()) {
    const t0 = Date.now();
    let fit: FitResult | null = null;
    try {
      fit = await analyzeFit(r, TIER);
    } catch (e) {
      console.log(`  ${i + 1}/${rows.length} HATA: ${(e as Error).message}`);
    }
    const ms = Date.now() - t0;
    if (!fit) {
      failed++;
      // A null is not "this posting was hard". analyzeFit returns null when the
      // whole chain is unavailable -- out of balance, benched, rate-limited --
      // and once benched the next call returns null instantly, so the run
      // marches through every row reporting nothing in about a second. The
      // first run of this script did exactly that: five failures, no reason,
      // and the reason (Cerebras out of balance) took a separate diagnostic to
      // find. Stop at the second one and say so instead.
      if (failed >= 2 && lat.length === 0) {
        console.error(
          [
            "",
            `${judge.name} yanıt vermiyor — zincir tükenmiş olabilir (bakiye bitti,`,
            "bench'te, ya da kota dolu). analyzeFit bu durumda istisna değil null döner,",
            "o yüzden satır satır denemek sadece aynı sessizliği tekrarlar.",
            "Başka bir sağlayıcı deneyin: LLM_ONLY=anthropic npm run judge:compare",
          ].join("\n"),
        );
        process.exitCode = 1;
        return;
      }
      continue;
    }
    lat.push(ms);
    const d = fit.fitScore - (r.fitScore ?? 0);
    deltas.push(Math.abs(d));
    if (fit.verdict === r.fitVerdict) verdictSame++;
    else {
      disagreements.push(
        `    ${r.fitVerdict}→${fit.verdict}  (${r.fitScore}→${fit.fitScore})  ${r.title.slice(0, 52)} — ${r.company.slice(0, 26)}`,
      );
    }
    if (fit.category === r.fitCategory) categorySame++;
    if (fit.ghostRisk === (r.ghostRisk ?? false)) ghostSame++;
    if ((i + 1) % 5 === 0) {
      console.log(`  ${i + 1}/${rows.length} — ${Math.round(median(lat) / 100) / 10}s/yargı (medyan)`);
    }
  }

  const n = lat.length;
  const wall = (Date.now() - startedAt) / 1000;
  const pct = (k: number) => (n ? `%${Math.round((k / n) * 100)}` : "-");

  console.log(`\n═══ Sonuç (${n} başarılı, ${failed} başarısız) ═══`);
  console.log(`  verdict uyumu   ${pct(verdictSame)}  (${verdictSame}/${n})`);
  console.log(`  kategori uyumu  ${pct(categorySame)}  (${categorySame}/${n})`);
  console.log(`  ghostRisk uyumu ${pct(ghostSame)}  (${ghostSame}/${n})`);
  console.log(`  |Δskor| ort     ${(deltas.reduce((a, b) => a + b, 0) / (n || 1)).toFixed(1)} puan, medyan ${median(deltas).toFixed(1)}`);
  console.log(`  gecikme         medyan ${(median(lat) / 1000).toFixed(1)}s, toplam ${wall.toFixed(0)}s`);
  if (disagreements.length) {
    console.log(`\n  Verdict ayrışmaları (${disagreements.length}):`);
    console.log(disagreements.join("\n"));
  }
  console.log(
    "\n  Not: bu bir kalite ölçümü değil, UYUM ölçümüdür — yerelin doğru olduğu\n" +
    "  varsayılmıyor. Ayrışan satırları okumak, hangi hakemin haklı olduğunu\n" +
    "  söyleyen tek şey.",
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
