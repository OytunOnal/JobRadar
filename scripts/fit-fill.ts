import { analyzeFit } from "../src/lib/fit";
import { prisma } from "../src/lib/db";

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

import { appendFileSync } from "node:fs";

const args = process.argv.slice(2);
const WIDE = args.includes("--wide");
const limIdx = args.indexOf("--limit");
const LIMIT = limIdx !== -1 ? Number(args[limIdx + 1]) || 100000 : 100000;
// --wait N: on chain exhaustion, sleep N minutes and retry instead of exiting
// (free quotas refill on rolling/daily windows — an overnight run rides them).
const waitIdx = args.indexOf("--wait");
const WAIT_MIN = waitIdx !== -1 ? Number(args[waitIdx + 1]) || 30 : 0;
const TARGETS = ["de", "nl", "es", "ch", "dk", "se", "be", "pl", "fr", "pt", "at", "ie", "gb", "no", "fi"];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function log(line: string): void {
  const stamped = `[${new Date().toISOString().slice(0, 19)}] ${line}`;
  console.log(stamped);
  appendFileSync("fit-fill.log", stamped + "\n");
}

const freshCut = new Date(Date.now() - 45 * 86_400_000);
const where = WIDE
  ? {
      fitScore: null, delistedAt: null, duplicateOfId: null,
      status: { in: ["new", "interested"] },
      // 40+: a single title hit scores 40, and title-only sources cap
      // around it — the 50 bar was hiding half the eligible pool.
      score: { gte: 40 },
      postedAt: { gte: freshCut },
      OR: [{ country: { in: TARGETS } }, { workMode: "remote" }],
    }
  : {
      fitScore: null, delistedAt: null, duplicateOfId: null,
      status: { in: ["new", "interested"] },
      score: { gt: 50 },
      OR: [{ sponsorReg: true }, { visa: "yes" }],
    };

const total = await prisma.job.count({ where });
log(`=== fit:fill ${WIDE ? "wave-2 (geniş)" : "wave-1 (visa-pozitif)"} — kuyrukta ${total} ilan ===`);

let done = 0;
let failStreak = 0;
const skipped: string[] = []; // title-only rows wait for desc:fill
while (done < LIMIT) {
  const batch = await prisma.job.findMany({
    where: { ...where, id: { notIn: skipped } },
    orderBy: [{ sponsorReg: "desc" }, { score: "desc" }, { lastSeenAt: "desc" }],
    take: 25,
  });
  if (batch.length === 0) {
    log("Kuyruk boş — dalga tamamlandı.");
    break;
  }
  for (const j of batch) {
    if (done >= LIMIT) break;
    // Title-only rows have nothing for the model to read — desc:fill feeds
    // them; skip in-memory only, so they re-enter once a description lands.
    if ((j.description ?? "").length < j.title.length + 60) {
      skipped.push(j.id);
      continue;
    }
    try {
      const fit = await analyzeFit(j);
      if (!fit) {
        failStreak++;
      } else {
        failStreak = 0;
        await prisma.job.update({
          where: { id: j.id },
          data: {
            fitScore: fit.fitScore, fitVerdict: fit.verdict, fitComment: fit.comment,
            fitCategory: fit.category, ghostRisk: fit.ghostRisk,
            ...(fit.category === "NO_VISA" ? { visa: "no" } : {}),
          },
        });
        done++;
        if (done % 25 === 0) log(`  ${done}/${total} analiz edildi (son: ${j.company.slice(0, 24)} — ${fit.fitScore})`);
      }
    } catch (e: any) {
      failStreak++;
      log(`  hata (${j.company.slice(0, 20)}): ${String(e.message).slice(0, 90)}`);
    }
    if (failStreak >= 3) {
      if (WAIT_MIN > 0) {
        log(`Zincir tükendi — ${WAIT_MIN} dk uyuyup tekrar denenecek (şu ana dek ${done} analiz).`);
        await sleep(WAIT_MIN * 60_000);
        failStreak = 0;
      } else {
        log(`Zincir tükendi görünüyor (3 ardışık başarısızlık) — ${done} analizle zarifçe duruldu. Sonra tekrar koş.`);
        await prisma.$disconnect();
        process.exit(0);
      }
    }
    await sleep(1_500); // free-tier nezaket temposu
  }
}

log(`=== Bitti: ${done} ilan analiz edildi ===`);
await prisma.$disconnect();
