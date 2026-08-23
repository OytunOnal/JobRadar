import { prisma } from "../src/lib/db";
import { parseSections } from "../src/lib/sections";

// Why does a posting come back without sections? Two very different answers:
//
//   (a) the parser is too conservative — the structure is in the text and we
//       failed to see it. Fixable here.
//   (b) the text has no structure left — it was flattened by the OLD stripHtml
//       before it was ever stored, and the markup that carried the newlines is
//       gone. Not fixable offline; only a refetch can recover it.
//
// Telling (a) from (b) decides whether to tune regexes or to requeue desc:fill,
// so measure it before touching either.

const N = Number(process.argv[2]) || 4000;

async function main() {
  const rows = await prisma.job.findMany({
    where: { disqualified: false, content: { isNot: null } },
    select: { id: true, title: true, source: true, content: { select: { description: true } } },
    take: N,
    orderBy: { id: "asc" },
  });

  const bucket: Record<string, { n: number; srcs: Map<string, number>; sample: string[] }> = {};
  const put = (k: string, r: (typeof rows)[0], d: string) => {
    bucket[k] ??= { n: 0, srcs: new Map(), sample: [] };
    const b = bucket[k];
    b.n++;
    b.srcs.set(r.source, (b.srcs.get(r.source) ?? 0) + 1);
    if (b.sample.length < 3) b.sample.push(`${r.source} | ${r.title}\n${d.slice(0, 260)}`);
  };

  for (const r of rows) {
    const d = r.content!.description;
    const secs = parseSections(d);
    const headed = secs.some((s) => s.heading);
    if (headed) { put("OK: başlık bulundu", r, d); continue; }

    const lines = d.split("\n").filter((l) => l.trim());
    if (d.length < 400) put("A: çok kısa ilan (<400 karakter)", r, d);
    else if (lines.length <= 2) put("B: DÜZLEŞTİRİLMİŞ — satır yok (refetch gerek)", r, d);
    else if (!/(^|\n)\s*[-•*]/.test(d)) put("C: satır var ama madde imi yok", r, d);
    else put("D: madde imi var ama başlık tanınmadı", r, d);
  }

  const total = rows.length;
  console.log(`=== ${total} aday ilan ===\n`);
  for (const [k, b] of Object.entries(bucket).sort((a, b) => b[1].n - a[1].n)) {
    const top = [...b.srcs].sort((x, y) => y[1] - x[1]).slice(0, 4).map(([s, n]) => `${s}(${n})`).join(" ");
    console.log(`${k}: ${b.n} (${((b.n / total) * 100).toFixed(1)}%)  kaynaklar: ${top}`);
  }
  for (const [k, b] of Object.entries(bucket)) {
    if (k.startsWith("OK")) continue;
    console.log(`\n───── ${k} örnekleri ─────`);
    b.sample.forEach((s) => console.log("  " + s.replace(/\n/g, "\n  ") + "\n"));
  }
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
