import { prisma } from "../src/lib/db";
import { parseSections } from "../src/lib/sections";
import { fitUserPrompt } from "../src/lib/fit";

// How big does the fit window need to be for the DECIDING section to arrive
// whole? Retention measured 91.3% of requirements characters at a 3,000-char
// budget, which means one posting in eight hands the judge a truncated
// requirements list — the exact failure that produces a confident wrong
// verdict rather than an obviously bad one.
//
// Two knobs: the total budget, and whether requirements are capped at all.
// Measure both against the real prompt size, since the CV shares the context
// window and latency is paid per token.

const N = Number(process.argv[2]) || 4000;

// Re-implementation of the quota fill, parameterised, so strategies can be
// compared without editing the library.
function fill(
  secs: ReturnType<typeof parseSections>,
  budget: number,
  quota: Array<[string, number]>,
): { text: string; reqKept: number; reqFull: number } {
  const blocks = secs.filter((s) => s.body.trim())
    .map((s, i) => ({ kind: s.kind as string, at: i, text: (s.heading ? `${s.heading}:\n` : "") + s.body }));
  const kept = new Map<number, string>();
  let used = 0;
  const take = (kind: string, cap: number) => {
    let room = Math.min(cap, budget - used);
    for (const b of blocks) {
      if (room <= 0) break;
      if (b.kind !== kind) continue;
      const already = kept.get(b.at)?.length ?? 0;
      if (already >= b.text.length) continue;
      let end = already + Math.min(room, b.text.length - already);
      if (end < b.text.length) {
        const nl = b.text.lastIndexOf("\n", end);
        if (nl > already + 40) end = nl;
      }
      const add = end - already;
      if (add <= 0 || (already === 0 && add < 120 && b.text.length > add)) continue;
      kept.set(b.at, b.text.slice(0, end));
      room -= add; used += add;
    }
  };
  for (const [k, q] of quota) take(k, q);
  for (const [k] of quota) take(k, budget - used);
  let reqKept = 0, reqFull = 0;
  for (const b of blocks) {
    if (b.kind !== "requirements") continue;
    reqFull += b.text.length;
    reqKept += kept.get(b.at)?.length ?? 0;
  }
  return { text: [...kept.entries()].sort((a, b) => a[0] - b[0]).map(([, t]) => t).join("\n\n"), reqKept, reqFull };
}

const STRATEGIES: Array<[string, number, Array<[string, number]>]> = [
  ["bugün (3000, req 1200)", 3000, [["requirements", 1200], ["responsibilities", 900], ["niceToHave", 350], ["visa", 250], ["intro", 500], ["other", 500]]],
  ["3000, req sınırsız", 3000, [["requirements", 3000], ["responsibilities", 900], ["niceToHave", 350], ["visa", 250], ["intro", 500], ["other", 500]]],
  ["3500, req 1800", 3500, [["requirements", 1800], ["responsibilities", 1000], ["niceToHave", 400], ["visa", 250], ["intro", 500], ["other", 500]]],
  ["4000, req sınırsız", 4000, [["requirements", 4000], ["responsibilities", 1200], ["niceToHave", 450], ["visa", 250], ["intro", 600], ["other", 500]]],
  ["4500, req sınırsız", 4500, [["requirements", 4500], ["responsibilities", 1400], ["niceToHave", 500], ["visa", 300], ["intro", 700], ["other", 600]]],
];

async function main() {
  const rows = await prisma.job.findMany({
    where: { disqualified: false, content: { isNot: null } },
    select: { title: true, content: { select: { description: true } } },
    take: N,
    orderBy: { id: "asc" },
  });
  const parsed = rows.map((r) => parseSections(r.content!.description));

  // The prompt carries the CV too; measure the real total, not the slice.
  const base = fitUserPrompt({ title: "t", company: "c", description: "" }).length;
  console.log(`CV + yönergeler (açıklama hariç): ${base} karakter ≈ ${Math.round(base / 4)} token`);
  console.log(`bağlam penceresi 8192 token → açıklamaya kalan ≈ ${8192 - Math.round(base / 4) - 200} token ≈ ${(8192 - Math.round(base / 4) - 200) * 4} karakter\n`);

  for (const [name, budget, quota] of STRATEGIES) {
    let kept = 0, full = 0, whole = 0, cut = 0, chars = 0;
    for (const secs of parsed) {
      const r = fill(secs, budget, quota);
      kept += r.reqKept; full += r.reqFull; chars += r.text.length;
      if (r.reqFull === 0) continue;
      if (r.reqKept >= r.reqFull) whole++; else cut++;
    }
    const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : "–");
    console.log(
      `${name.padEnd(24)} gereksinim ${pct(kept, full).padStart(6)} tutuldu | tam geçen ${pct(whole, whole + cut).padStart(6)} | ort. istem ${Math.round(base + chars / parsed.length)} ka ≈ ${Math.round((base + chars / parsed.length) / 4)} token`,
    );
  }
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
