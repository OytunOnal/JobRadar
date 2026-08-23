import { prisma } from "../src/lib/db";
import { parseSections, postingView, type SectionKind } from "../src/lib/sections";
import { factsUserPrompt } from "../src/lib/facts";

// A full audit of the sectioning, not a single headline number. Four
// questions, each of which fails in a different way and needs different work:
//
//   A. BOUNDARIES  — is the posting cut in the right places? Over-splitting
//      (a body line read as a heading) and under-splitting (a heading missed,
//      so two sections fuse) are both invisible in a "% structured" figure.
//   B. LOSS        — does a per-consumer view drop text the consumer needed?
//      This is the dangerous failure: the pipeline still runs, the prompt
//      still looks fine, and the evidence is simply gone.
//   C. MISFILING   — is a section labelled as something it is not? Only the
//      kinds a view DROPS can hurt, so weight the check that way.
//   D. UNPARSEABLE — of the postings with no sections, why not?
//
//   npm run audit:sections [-- --n 6000 --show 3]

const args = process.argv.slice(2);
const num = (flag: string, dflt: number) => {
  const i = args.indexOf(flag);
  return i !== -1 ? Number(args[i + 1]) || dflt : dflt;
};
const N = num("--n", 6000);
const SHOW = num("--show", 3);

// Content fingerprints. Deliberately independent of the heading vocabulary —
// if they shared patterns, the audit would only confirm its own assumptions.
const MARKERS: Record<string, RegExp> = {
  gereksinim: /\b(\d+\+?\s*(years?|jahre|años|ans)|years? of experience|jahre\w* erfahrung|proficien\w+|degree in|bachelor|master'?s|experience (with|in|using))\b/i,
  vize: /\b(visa|sponsor\w*|work permit|right to work|relocation|arbeitserlaubnis)\b/i,
  dil: /\b(fluent in|fluency|native speaker|c1|b2|deutschkenntnisse|fließend|language skills)\b/i,
  kıdem: /\b(senior|junior|principal|staff|lead|entry[\s-]level|graduate|intern)\b/i,
  maaş: /\b(salary|compensation|€|\$|gehalt|per year|annually)\b/i,
};
const sample = <T,>(xs: T[], k: number) => xs.slice(0, k);

interface LossRow { kind: string; lost: number; had: number }

async function main() {
  const rows = await prisma.job.findMany({
    where: { disqualified: false, content: { isNot: null } },
    select: { id: true, title: true, source: true, content: { select: { description: true } } },
    take: N,
    orderBy: { id: "asc" },
  });

  // ── A. boundaries ──────────────────────────────────────────────────────
  let structured = 0, secCount = 0;
  let emptyBody = 0, hugeBody = 0, tinyBody = 0, headingRuns = 0;
  const hugeSamples: string[] = [], runSamples: string[] = [];

  // ── B. loss ────────────────────────────────────────────────────────────
  const loss: Record<string, Record<string, LossRow>> = {};
  const lossSamples: Record<string, string[]> = {};
  const VIEWS = ["fit", "facts", "embed"] as const;
  for (const v of VIEWS) {
    loss[v] = {};
    for (const m of Object.keys(MARKERS)) loss[v][m] = { kind: m, lost: 0, had: 0 };
    lossSamples[v] = [];
  }

  // ── C. misfiling ───────────────────────────────────────────────────────
  // Only kinds the fit view DROPS can cost us anything.
  const DROPPED_BY_FIT: SectionKind[] = ["company", "benefits", "legal", "process"];
  const misfiled = new Map<string, number>();
  const misfiledSamples: string[] = [];
  let reqLikePerk = 0;
  let roleInCompany = 0;
  const roleInCompanySamples: string[] = [];
  const perkInReqSamples: string[] = [];
  const PERK_ONLY = /\b(paid time off|days? of (paid )?(leave|holiday|vacation)|health insurance|pension|free (lunch|snacks)|team events?|gym membership)\b/i;

  // ── D. unparseable ─────────────────────────────────────────────────────
  const why = new Map<string, number>();
  const whySamples = new Map<string, string[]>();

  for (const r of rows) {
    const d = r.content!.description;
    const secs = parseSections(d);
    const headed = secs.filter((s) => s.heading);

    if (headed.length === 0) {
      const lines = d.split("\n").filter((l) => l.trim());
      const k = d.length < 400 ? "A: gövde yok/çok kısa (<400)"
        : lines.length <= 2 ? "B: düzleştirilmiş (satır yok)"
        : !/(^|\n)\s*[-•*]/.test(d) ? "C: satırlı düz nesir, madde imi yok"
        : "D: madde imli ama başlık tanınmadı";
      why.set(k, (why.get(k) ?? 0) + 1);
      const bag = whySamples.get(k) ?? [];
      if (bag.length < SHOW) bag.push(`${r.source} | ${r.title}\n${d.slice(0, 300)}`);
      whySamples.set(k, bag);
      continue;
    }

    structured++;
    secCount += secs.length;

    // A: boundary health
    let run = 0;
    for (const s of secs) {
      if (!s.body.trim() && s.heading) {
        emptyBody++;
        run++;
        if (run === 3 && runSamples.length < SHOW) {
          runSamples.push(`${r.source} | ${r.title}\n  ardışık boş başlıklar: ${secs.filter((x) => !x.body.trim()).map((x) => x.heading).slice(0, 6).join(" / ")}`);
          headingRuns++;
        }
      } else run = 0;
      if (s.body.length > 2500) {
        hugeBody++;
        if (hugeSamples.length < SHOW) hugeSamples.push(`${r.source} | ${r.title}\n  "${s.heading}" (${s.kind}) gövdesi ${s.body.length} karakter — içeride kaçan başlık olabilir:\n  ${s.body.slice(0, 240).replace(/\n/g, " ⏎ ")}`);
      }
      if (s.heading && s.body.trim().length > 0 && s.body.trim().length < 25) tinyBody++;
    }

    // B: does each view keep the evidence the full text had?
    for (const v of VIEWS) {
      // Measure what the STAGE receives, not what one helper returns: the
      // facts stage sends the sectioned view plus the signal-line rescue, so
      // scoring it on the view alone would understate its real coverage.
      const view = v === "facts" ? factsUserPrompt(r.title, "c", d) : postingView(d, v);
      for (const [name, re] of Object.entries(MARKERS)) {
        if (!re.test(d)) continue;
        loss[v][name].had++;
        if (!re.test(view)) {
          loss[v][name].lost++;
          if (name === "gereksinim" && lossSamples[v].length < SHOW) {
            lossSamples[v].push(`${r.source} | ${r.title} — tam metin ${d.length}ka, görünüm ${view.length}ka | bölümler: ${secs.map((s) => s.kind).join(",")}`);
          }
        }
      }
    }

    // C: is evidence sitting in a section fit throws away?
    for (const s of secs) {
      if (!DROPPED_BY_FIT.includes(s.kind)) continue;
      if (!MARKERS.gereksinim.test(s.body)) continue;
      const key = `${s.kind} ← ${s.heading.toLowerCase().slice(0, 45)}`;
      misfiled.set(key, (misfiled.get(key) ?? 0) + 1);
      if (misfiledSamples.length < SHOW) {
        misfiledSamples.push(`${r.source} | "${s.heading}" (${s.kind})\n  ${s.body.slice(0, 220).replace(/\n/g, " ⏎ ")}`);
      }
    }
    // C2: the worst failure mode — a long section we DROP that reads like the
    // role itself ("you will build...", "your responsibilities"). This is how
    // a posting can reach the judge with its actual job description missing.
    // Only a real loss when the posting has NO responsibilities section of its
    // own: role language inside an "about us" blurb is normal padding when the
    // job is also described properly somewhere the fit view keeps.
    const hasRole = secs.some((s) => s.kind === "responsibilities" && s.body.length > 200);
    for (const s of secs) {
      if (hasRole) break;
      if (s.kind !== "company" || s.body.length < 1200) continue;
      if (!/\b(you will|you'?ll|your responsibilities|in this role|we are looking for someone)\b/i.test(s.body)) continue;
      roleInCompany++;
      if (roleInCompanySamples.length < SHOW) {
        roleInCompanySamples.push(`${r.source} | "${s.heading}" (${s.body.length} ka)\n  ${s.body.slice(0, 200).replace(/\n/g, " ⏎ ")}`);
      }
    }
    for (const s of secs) {
      if (s.kind !== "requirements") continue;
      if (PERK_ONLY.test(s.body) && !MARKERS.gereksinim.test(s.body)) {
        reqLikePerk++;
        if (perkInReqSamples.length < SHOW) {
          perkInReqSamples.push(`${r.source} | "${s.heading}"\n  ${s.body.slice(0, 200).replace(/\n/g, " ⏎ ")}`);
        }
      }
    }
  }

  const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : "–");
  console.log(`\n════ ${rows.length} aday ilan denetlendi ════\n`);

  console.log("── A. SINIRLAR: parçalanma düzgün mü? ──");
  console.log(`yapılı ilan: ${structured} (${pct(structured, rows.length)}), ilan başına ort. ${(secCount / Math.max(structured, 1)).toFixed(1)} bölüm`);
  console.log(`  gövdesiz başlık: ${emptyBody} (aşırı bölme belirtisi; ${headingRuns} ilanda 3+ ardışık)`);
  console.log(`  çok kısa gövde (<25 ka): ${tinyBody}`);
  console.log(`  çok uzun gövde (>2500 ka): ${hugeBody} (eksik bölme belirtisi — içeride kaçan başlık)`);
  sample(hugeSamples, SHOW).forEach((s) => console.log("   • " + s));
  sample(runSamples, SHOW).forEach((s) => console.log("   • " + s));

  console.log("\n── B. KAYIP: görünüm, tam metindeki kanıtı koruyor mu? ──");
  console.log("   (tam metinde işaret VAR ama görünümde YOK → kayıp)");
  for (const v of VIEWS) {
    const parts = Object.values(loss[v])
      .map((r) => `${r.kind} ${pct(r.lost, r.had)}`)
      .join("  ");
    console.log(`  ${v.padEnd(6)} ${parts}`);
  }
  console.log("  fit görünümünde gereksinim kaybı örnekleri:");
  sample(lossSamples.fit, SHOW).forEach((s) => console.log("   • " + s));

  console.log("\n── C. YANLIŞ ATAMA: fit'in attığı bölümlerde gereksinim var mı? ──");
  const mis = [...misfiled].sort((a, b) => b[1] - a[1]);
  console.log(`  etkilenen bölüm sayısı: ${mis.reduce((a, [, n]) => a + n, 0)}`);
  mis.slice(0, 12).forEach(([k, n]) => console.log(`   ${String(n).padStart(4)} ${k}`));
  sample(misfiledSamples, SHOW).forEach((s) => console.log("   • " + s));
  console.log(`  ATILAN company bölümünde rol anlatımı olan ilan: ${roleInCompany}`);
  sample(roleInCompanySamples, SHOW).forEach((x) => console.log("   • " + x));
  console.log(`  requirements sanılan ama yalnız yan hak içeren bölüm: ${reqLikePerk}`);
  sample(perkInReqSamples, SHOW).forEach((s) => console.log("   • " + s));

  console.log("\n── D. PARÇALANAMAYANLAR: neden? ──");
  const total = rows.length;
  [...why].sort((a, b) => b[1] - a[1]).forEach(([k, n]) => console.log(`  ${k}: ${n} (${pct(n, total)})`));
  for (const [k, bag] of whySamples) {
    console.log(`\n  ▸ ${k}`);
    bag.forEach((s) => console.log("     " + s.replace(/\n/g, "\n     ")));
  }

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
