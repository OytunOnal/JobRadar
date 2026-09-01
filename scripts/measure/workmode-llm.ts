import { prisma } from "../../src/lib/db";
import { getJSON } from "../../src/lib/sources/types";
import { leverSections } from "../../src/lib/sources/ats/lever";
import { extractFacts } from "../../src/lib/llm/facts";
import { detectWorkMode } from "../../src/lib/text/workmode";

// DOES THE FACTS EXTRACTOR EARN THE RIGHT TO WRITE workMode?
//
// The layer order is source > text > llm, and the llm's writing rights are
// gated on this measurement: APPLY_LLM_WORKMODE in visa-write.ts stays false
// until the extractor clears the bar the text detector cleared — ~90% correct
// where it speaks, against employers' own dropdown values.
//
// Ground truth is collected fresh from Lever boards each run (workplaceType,
// the employer's own field), so the corpus can never have leaked into prompt
// tuning. The interesting slice is where the LLM is actually allowed to write:
// postings where the TEXT DETECTOR is silent — its precision there is the
// number that matters, and it is scored separately.
//
// Wants the GPU (one extractFacts call per posting, ~5s each on the 8B):
//   npx tsx scripts/measure/workmode-llm.ts            # 150 postings, ~15 min
//   npx tsx scripts/measure/workmode-llm.ts --n 400

const N = Number(process.argv[process.argv.indexOf("--n") + 1]) || 150;

// ── Collect employer-labelled postings ──────────────────────────────────────
const boards = await prisma.atsBoard.findMany({
  where: { platform: "lever", status: "active" },
  select: { token: true, companyName: true, region: true },
  orderBy: { validatedAt: "desc" }, // a different ordering than the tuning corpora used
});

interface Row { label: string; title: string; company: string; location: string; description: string }
const rows: Row[] = [];
for (const b of boards) {
  if (rows.length >= N) break;
  const host = b.region === "eu" ? "api.eu.lever.co" : "api.lever.co";
  let data: unknown;
  try { data = await getJSON(`https://${host}/v0/postings/${b.token}?mode=json`); }
  catch { continue; }
  let kept = 0;
  for (const j of Array.isArray(data) ? data : []) {
    if (kept >= 6) break;
    const label = j.workplaceType;
    if (label !== "remote" && label !== "hybrid" && label !== "onsite") continue;
    const body = leverSections(j).map(([h, v]) => `${h}\n${typeof v === "string" ? v : ""}`).join("\n")
      || String(j.descriptionPlain ?? "");
    rows.push({
      label,
      title: String(j.text ?? ""),
      company: b.companyName ?? b.token,
      location: String(j.categories?.location ?? ""),
      description: body.replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").trim().slice(0, 4000),
    });
    kept++;
  }
}
console.log(`${rows.length} employer-labelled postings collected`);

// ── Run the extractor ───────────────────────────────────────────────────────
const L = ["remote", "hybrid", "onsite"] as const;
const all: Record<string, Record<string, number>> = {};
const silent: Record<string, Record<string, number>> = {};
for (const a of [...L, "unstated"]) { all[a] = { remote: 0, hybrid: 0, onsite: 0 }; silent[a] = { remote: 0, hybrid: 0, onsite: 0 }; }
let done = 0;
const t0 = Date.now();

for (const r of rows) {
  // The location travels in the prompt the same way production sends it:
  // production's description is the posting body; title/company are fields.
  // detectWorkMode's answer decides which scoring bucket this row is in.
  const facts = await extractFacts({ title: r.title, company: r.company, description: `${r.location}\n${r.description}` });
  const said = facts?.workMode ?? "unstated";
  all[said]![r.label]++;
  if (!detectWorkMode(r.title, r.location, r.description)) silent[said]![r.label]++;
  done++;
  if (done % 25 === 0) {
    const per = (Date.now() - t0) / done / 1000;
    console.log(`  ${done}/${rows.length}  (${per.toFixed(1)}s each, ~${Math.round((rows.length - done) * per / 60)} min left)`);
  }
}

function report(name: string, m: Record<string, Record<string, number>>) {
  const n = Object.values(m).reduce((s, r) => s + r.remote + r.hybrid + r.onsite, 0);
  const spoke = n - m.unstated!.remote - m.unstated!.hybrid - m.unstated!.onsite;
  const correct = L.reduce((s, l) => s + m[l]![l], 0);
  console.log(`\n── ${name} (n=${n})`);
  console.log(`  spoke on ${spoke} (${n ? (100 * spoke / n).toFixed(1) : 0}%)   correct where it spoke ${spoke ? (100 * correct / spoke).toFixed(1) : "-"}%`);
  console.log("              truth:  remote  hybrid  onsite");
  for (const a of [...L, "unstated"])
    console.log(`   said ${a.padEnd(9)}    ${String(m[a]!.remote).padStart(6)}  ${String(m[a]!.hybrid).padStart(6)}  ${String(m[a]!.onsite).padStart(6)}`);
}

report("extractor, all postings", all);
report("extractor, where the text detector is silent — its actual jurisdiction", silent);
console.log("\nIf the jurisdiction number clears ~90%, flip APPLY_LLM_WORKMODE in visa-write.ts.");
await prisma.$disconnect();
