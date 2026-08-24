import { analyzeFit, judgeQueueWhere, unjudgedWhere, verdictFields, FIT_PROMPT_VERSION } from "../src/lib/fit";
import { andWhere } from "../src/lib/pool";
import { VISA_MARKED } from "../src/lib/visa";
import { chunkFromArgs, chunkWhere } from "../src/lib/chunks";
import { prisma } from "../src/lib/db";
import { acquireGpu, beatGpu, gpuBusyMessage, releaseGpu } from "../src/lib/gpu-lock";
import { blendOrder, cosine, cvVector, fromBuffer } from "../src/lib/embed";
import { extractFacts, EXTRACTOR_VERSION } from "../src/lib/facts";
import { applyFactsToJob } from "../src/lib/visa-write";
import { levelBlocked, type SeniorityLevel } from "../src/lib/seniority";
import { profile, seniorityFor } from "../src/lib/profile";

// Paced fit-analysis backlog filler over the FREE provider chain. Wave 1 (the
// user's pick): score > 50 AND visa-positive — the company is in a public
// sponsor register OR the posting itself says sponsorship. Most-applyable
// first: sponsor-registered, then score, then recency.
//
// Self-resuming (works off fitScore=null), stops gracefully when the whole
// provider chain is exhausted (3 consecutive all-provider failures), logs
// every 25 jobs to fit-fill.log.
//
//   npm run fit:fill                  (wave 1)
//   npm run fit:fill -- --wide        (wave 2: score > 50, target-or-remote, fresh)
//   npm run fit:fill -- --limit 500

import { backfill } from "../src/lib/backfill";

const args = process.argv.slice(2);
const WIDE = args.includes("--wide");
// --wait N: on chain exhaustion, sleep N minutes and retry instead of stopping
// (free quotas refill on rolling/daily windows — an overnight run rides them).
const waitIdx = args.indexOf("--wait");
const WAIT_MIN = waitIdx !== -1 ? Number(args[waitIdx + 1]) || 30 : 0;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --min-score / --max-score: judge one score chunk. Which postings come next
// is the chunk's job; which of them is read first stays the blend's.
const CHUNK = chunkFromArgs(args);
// --visa-marked: judge only postings we already know can sponsor (public
// register, a source's structured flag, or the posting's own words). The
// user's stated priority, and knowable without spending a second of GPU.
const VISA_ONLY = args.includes("--visa-marked");
// One clock for the whole run, frozen here. The 45-day cut-off inside
// judgeTargetWhere used to be computed per call, so evaluating it twice in one
// expression produced two subtly different filters out of what reads as one.
const NOW = new Date();
const where = andWhere(
  judgeQueueWhere(WIDE, NOW),
  chunkWhere(CHUNK),
  VISA_ONLY ? VISA_MARKED : null,
);

// Blended queue: visa-positive tier first, then the measured 40/60
// keyword/embedding rank blend (see src/lib/embed.ts). Jobs without a vector
// ride their keyword rank. The queue is REBUILT every RESNAPSHOT analyses:
// during a big pull, visa-positive jobs arriving mid-run must jump ahead of
// an old snapshot's tail, not wait for the next process restart.
let cv: number[] | null = null;

const skipped: string[] = []; // title-only rows wait for desc:fill

// Facts we already extracted can rule a posting out before the 27B ever
// reads it: a talent-pool ad with no real opening, a language the candidate
// does not work in, a level the track avoids. These are NOT dropped — the
// store-all rule holds and a profile change can revive them — but they go to
// the very back of the queue, behind even the postings that refuse visas.
// Judging one of these costs a minute stolen from a live option.
//
// Note the split this keeps: facts DETECT (ghost wording, a required
// language, a stated level), the profile JUDGES (whether that language or
// level is a barrier for THIS person). Nothing here is hardcoded to one CV.
function factsRuleOut(f: { ghostRisk: boolean; langReq: string | null; seniorityLevel: string | null } | null, track: string | null): boolean {
  if (!f) return false;
  if (f.ghostRisk) return true;
  const needed = (f.langReq ?? "").split(",").filter(Boolean);
  if (needed.some((c) => !profile.languages.includes(c))) return true;
  const level = (f.seniorityLevel ?? "unknown") as SeniorityLevel;
  return level !== "unknown" && levelBlocked(level, seniorityFor(track ?? undefined).avoid);
}

async function buildQueue(): Promise<string[]> {
  const candidates = await prisma.job.findMany({
    where: andWhere(where, { id: { notIn: skipped } }),
    select: {
      id: true, score: true, visaTier: true, track: true,
      vector: { select: { vector: true } },
      facts: { select: { ghostRisk: true, langReq: true, seniorityLevel: true } },
    },
  });
  // Tier order by CERTAINTY of the sponsorship route, then the measured
  // keyword/embedding blend inside each tier. Postings that explicitly refuse
  // sponsorship go LAST: for a candidate who needs it they are dead ends, and
  // GPU minutes spent there are minutes stolen from live options. ("not-needed"
  // rides at the top with yes — no barrier at all.)
  const RANK: Record<string, number> = { "not-needed": 0, yes: 0, maybe: 1, unknown: 2, no: 3 };
  const scored = candidates.map((c) => ({
    id: c.id,
    score: c.score,
    // Tier 4 is the facts-ruled-out lane: last in line, still in line.
    rank: factsRuleOut(c.facts, c.track) ? 4 : RANK[c.visaTier] ?? 2,
    sim: cv && c.vector ? cosine(fromBuffer(c.vector.vector), cv) : null,
  }));
  return [0, 1, 2, 3, 4].flatMap((r) => blendOrder(scored.filter((s) => s.rank === r))).map((s) => s.id);
}

const RESNAPSHOT = 100;

export async function main() {
 await backfill("fit-fill", { budget: 100_000, gpu: "manual/fit" }, async (run) => {
  // The CV vector is a network call to the embedder — it used to run at
  // IMPORT, so merely importing this file to reach factsRuleOut or buildQueue
  // opened a connection and started the run behind it.
  try {
    cv = await cvVector();
  } catch {
    run.log("(embedding modeli erişilemez — kuyruk salt keyword sırasıyla)");
  }

  let queue = await buildQueue();
  run.log(`=== fit:fill ${WIDE ? "wave-2 (geniş)" : "wave-1 (visa-pozitif)"} — kuyrukta ${queue.length} ilan (harmanlı sıra${cv ? "" : " YOK"}, ${RESNAPSHOT} analizde bir tazelenir) ===`);
  const total = queue.length;

let done = 0;
let chainFails = 0;
let factsDone = 0;
let ruledOut = 0;
let cursor = 0;
let sinceSnapshot = 0;
while (run.round()) {
  if (sinceSnapshot >= RESNAPSHOT || cursor >= queue.length) {
    queue = await buildQueue();
    cursor = 0;
    sinceSnapshot = 0;
    if (queue.length === 0) return run.drained();
    run.log(`  kuyruk tazelendi: ${queue.length} ilan`);
  }
  const ids = queue.slice(cursor, cursor + 25);
  cursor += ids.length;
  const rows = await prisma.job.findMany({
    // The SAME "not judged by this system" test the queue was built from. A
    // second, narrower copy here (`fitScore: null`) queued every stale-verdict
    // posting and then dropped it from the batch, so nothing was ever
    // re-judged and the loop just spun.
    where: andWhere({ id: { in: ids } }, unjudgedWhere()),
    include: {
      content: { select: { description: true } },
      facts: { select: { extractorVersion: true, ghostRisk: true, langReq: true, seniorityLevel: true } },
    },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const batch = ids.map((id) => byId.get(id)).filter((r): r is NonNullable<typeof r> => Boolean(r));
  if (batch.length === 0) continue;
  for (const j of batch) {
    if (run.exhausted()) break;
    // Title-only rows have nothing for the model to read — desc:fill feeds
    // them; skip in-memory only, so they re-enter once a description lands.
    const desc = j.content?.description ?? "";
    if (desc.length < j.title.length + 60) {
      skipped.push(j.id);
      continue;
    }
    try {
      // Extract the posting's facts FIRST, and only for a posting we are
      // about to judge. Running facts over the whole pool would be 218 GPU
      // hours for 78k rows, most of which will never be judged at all; doing
      // it here costs ~12s on top of a ~50s judgment and nothing on the rows
      // we never reach. The judgment needs it: visa tier, language and level
      // reach the prompt as structured lines, not as prose to be re-derived.
      let job = j;
      if (!j.facts || j.facts.extractorVersion !== EXTRACTOR_VERSION) {
        const facts = await extractFacts({ title: j.title, company: j.company, description: desc });
        if (facts) {
          await applyFactsToJob(j.id, facts);
          const fresh = await prisma.job.findUnique({
            where: { id: j.id },
            select: { visaTier: true, seniorityLevel: true, langReq: true },
          });
          if (fresh) job = { ...j, ...fresh };
          factsDone++;
        }
      }
      // Ruled out by its facts? It still gets judged — the user's rule is
      // "last in line", not "never" — and buildQueue's tier 4 is what puts it
      // there. This used to also skip the judgment right here, which looked
      // like the same thing and was not: the skip only fired on the pass that
      // extracted the facts, so the posting was judged normally on the next
      // one. Two mechanisms for one rule, one of them accidental. Counting it
      // keeps the effect visible without a second code path.
      if (factsRuleOut(j.facts as any, j.track)) ruledOut++;
      const fit = await analyzeFit({ ...job, description: desc, visaTier: job.visaTier, seniorityLevel: job.seniorityLevel, langReq: job.langReq });
      if (!fit) {
        chainFails++;
        if (!(await waited(run, chainFails))) run.failed();
        else chainFails = 0;
        continue;
      }
      chainFails = 0;
      await prisma.job.update({
        where: { id: j.id },
        // Single-tier regime (user decision 2026-08-21): the 27B judges
        // directly — no 8B triage, no separate review pass to await.
        data: verdictFields(fit, "qwen27b", j),
      });
      done++;
      sinceSnapshot++;
      run.did();
      if (done % 25 === 0) run.log(`  ${done}/${total} analiz edildi, ${factsDone} çıkarım (son: ${j.company.slice(0, 24)} — ${fit.fitScore})`);
    } catch (e) {
      chainFails++;
      if (!(await waited(run, chainFails))) run.failed(e);
      else chainFails = 0;
    }
    // Politeness pacing is for cloud quotas; a local Ollama needs none.
    await sleep(Number(process.env.FIT_SLEEP_MS ?? 1_500));
  }
}

run.log(`${factsDone} çıkarım, ${ruledOut} ilan gerçekleriyle son kademede`);
 });
}

// --wait rides out an exhausted provider chain instead of stopping, so those
// failures must NOT reach the runner's fail-streak — the whole point of the
// flag is that an overnight run survives them.
async function waited(run: { log(l: string): void; done: number }, fails: number): Promise<boolean> {
  if (WAIT_MIN <= 0 || fails < 3) return false;
  run.log(`Zincir tükendi — ${WAIT_MIN} dk uyuyup tekrar denenecek (şu ana dek ${run.done} analiz).`);
  await sleep(WAIT_MIN * 60_000);
  return true;
}

// The backfill runs only when this file is the entry point. buildQueue and
// factsRuleOut are the interesting parts of this file and neither could be
// reached from a test while importing it started a judging run.
const isEntryPoint = process.argv[1]?.replace(/\\/g, "/").endsWith("fit-fill.ts");
if (isEntryPoint) await main();
