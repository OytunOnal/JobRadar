import { prisma } from "../src/lib/db";
import { parseSections } from "../src/lib/sections";
import { fitUserPrompt } from "../src/lib/fit";
import { factsPrompt } from "../src/lib/facts";

// What budget does a view need before EVERY section it keeps arrives whole?
//
// Retention is the honest measure of a projection: a section that arrives
// half-cut is not a shorter version of itself, it is a different and wrong
// one. So rather than tuning a number until a headline looks good, measure
// the demand — how many characters each view's kept kinds actually occupy —
// and read the budget off the distribution.
//
//   npm run tune:fitwindow [-- 6000]

const N = Number(process.argv[2]) || 6000;

// Which kinds each view keeps, in the same priority order as lib/sections.
const KEEP: Record<string, string[]> = {
  fit: ["requirements", "responsibilities", "niceToHave", "visa", "intro", "other"],
  facts: ["visa", "requirements", "benefits", "intro", "responsibilities", "other"],
  embed: ["responsibilities", "requirements", "niceToHave", "intro", "other"],
};

const q = (xs: number[], p: number) => xs[Math.min(xs.length - 1, Math.floor(xs.length * p))];

async function main() {
  const rows = await prisma.job.findMany({
    where: { disqualified: false, content: { isNot: null } },
    select: { content: { select: { description: true } } },
    take: N,
    orderBy: { id: "asc" },
  });
  const parsed = rows.map((r) => parseSections(r.content!.description));

  // Prompt overhead: the description shares the context window with the CV
  // and the instructions, so a budget is only affordable relative to these.
  const fitBase = fitUserPrompt({ title: "t", company: "c", description: "" }).length;
  const factsBase = factsPrompt().length;
  console.log(`fit istemi sabit yükü (CV + yönerge): ${fitBase} ka ≈ ${Math.round(fitBase / 4)} token`);
  console.log(`facts istemi sabit yükü: ${factsBase} ka ≈ ${Math.round(factsBase / 4)} token`);
  console.log(`bağlam penceresi 8192 token; üretim payı ~200 token\n`);

  for (const [view, keep] of Object.entries(KEEP)) {
    // Per posting: how many characters do this view's kept kinds occupy?
    const demand: number[] = [];
    const perKind: Record<string, number[]> = {};
    for (const secs of parsed) {
      let total = 0;
      for (const s of secs) {
        if (!s.body.trim() || !keep.includes(s.kind)) continue;
        const len = (s.heading ? s.heading.length + 2 : 0) + s.body.length;
        total += len;
        (perKind[s.kind] ??= []).push(len);
      }
      if (total) demand.push(total);
    }
    demand.sort((a, b) => a - b);
    console.log(`── ${view} ── ${demand.length} ilanda tutulan bölümlerin toplam uzunluğu`);
    console.log(`   ortanca ${q(demand, 0.5)}  |  %90 ${q(demand, 0.9)}  |  %95 ${q(demand, 0.95)}  |  %99 ${q(demand, 0.99)}  |  en uzun ${demand[demand.length - 1]}`);
    for (const kind of keep) {
      const xs = (perKind[kind] ?? []).sort((a, b) => a - b);
      if (!xs.length) continue;
      console.log(`     ${kind.padEnd(17)} n=${String(xs.length).padStart(5)}  ortanca ${String(q(xs, 0.5)).padStart(5)}  %95 ${String(q(xs, 0.95)).padStart(5)}  %99 ${String(q(xs, 0.99)).padStart(5)}`);
    }
    // What share of postings fit entirely inside a candidate budget?
    const line = [2000, 3000, 4000, 5000, 6000, 8000]
      .map((b) => `${b}:${((demand.filter((d) => d <= b).length / demand.length) * 100).toFixed(1)}%`)
      .join("  ");
    console.log(`   bütçeye TAM sığan ilan oranı → ${line}`);

    // The same, ignoring `intro`. An unstructured posting is ALL intro, so
    // including it measures "can we fit a whole 8,000-character blob", which
    // is not the question — there are no sections there to deliver whole.
    // The real target is the CLASSIFIED sections: those are the ones where a
    // cut turns a requirement into a different requirement.
    const named: number[] = [];
    for (const secs of parsed) {
      let total = 0;
      for (const s of secs) {
        if (!s.body.trim() || !keep.includes(s.kind) || s.kind === "intro") continue;
        total += (s.heading ? s.heading.length + 2 : 0) + s.body.length;
      }
      if (total) named.push(total);
    }
    named.sort((a, b) => a - b);
    const line2 = [2000, 3000, 4000, 5000, 6000]
      .map((b) => `${b}:${((named.filter((d) => d <= b).length / named.length) * 100).toFixed(1)}%`)
      .join("  ");
    console.log(`   intro HARİÇ (adlandırılmış bölümler): ortanca ${q(named, 0.5)} %95 ${q(named, 0.95)} %99 ${q(named, 0.99)}`);
    console.log(`   intro hariç tam sığan → ${line2}\n`);
  }
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
