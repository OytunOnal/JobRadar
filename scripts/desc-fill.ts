// Description backfill for title-only jobs. Six platforms' LIST endpoints
// carry no posting body (SmartRecruiters, Workday, Workable, BambooHR,
// Breezy, JOIN) — their stored jobs have description ≈ title, which caps the
// keyword score below the fit threshold AND starves fit analysis of text.
// This worker fetches each job's DETAIL endpoint (live-verified shapes),
// writes the real description, and re-scores the job — deserving ones cross
// the fit threshold naturally. Pure HTTP, zero LLM.
//
//   npm run desc:fill                (whole queue, priority-ordered)
//   npm run desc:fill -- --budget 500
//
// Priority: sponsor-registered → score → recency. Resumable by nature (the
// title-only check is the queue). Logs to desc-fill.log.

import { appendFileSync } from "node:fs";
import { prisma } from "../src/lib/db";
import { scoreJob, SCORER_VERSION } from "../src/lib/score";
import { detectVisa } from "../src/lib/visa";
import { deriveWorkMode, stripHtml } from "../src/lib/sources/types";

const args = process.argv.slice(2);
const bIdx = args.indexOf("--budget");
const BUDGET = bIdx !== -1 ? Number(args[bIdx + 1]) || 100000 : 100000;
const UA = "Mozilla/5.0 (compatible; JobRadar/0.1; personal job search)";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function log(line: string): void {
  const stamped = `[${new Date().toISOString().slice(0, 19)}] ${line}`;
  console.log(stamped);
  appendFileSync("desc-fill.log", stamped + "\n");
}

async function getJson(url: string): Promise<any | null> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function getHtml(url: string): Promise<string> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html" }, signal: AbortSignal.timeout(15_000), redirect: "follow" });
    if (!res.ok) return "";
    return (await res.text()).slice(0, 400_000);
  } catch {
    return "";
  }
}

function ogDescription(html: string): string {
  const m = html.match(/property="og:description"\s+content="([\s\S]*?)"\s*\/?>/) ||
    html.match(/content="([\s\S]*?)"\s+property="og:description"/);
  return m ? stripHtml(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&")) : "";
}

// Per-platform detail fetch → plain-text description ("" = unavailable).
async function fetchDescription(source: string, externalId: string, url: string): Promise<string> {
  const [platform, ...rest] = source.split(":");
  const token = rest.join(":");
  switch (platform) {
    case "sr": {
      const d = await getJson(`https://api.smartrecruiters.com/v1/companies/${token}/postings/${externalId}`);
      const s = d?.jobAd?.sections ?? {};
      return stripHtml([s.companyDescription?.text, s.jobDescription?.text, s.qualifications?.text, s.additionalInformation?.text].filter(Boolean).join("\n"));
    }
    case "workday": {
      // token = tenant@wdN/site; url pathname already starts with /site/...
      const tenant = token.split("@")[0];
      let u: URL;
      try { u = new URL(url); } catch { return ""; }
      const d = await getJson(`${u.origin}/wday/cxs/${tenant}${u.pathname}`);
      return stripHtml(d?.jobPostingInfo?.jobDescription ?? "");
    }
    case "workable": {
      const d = await getJson(`https://apply.workable.com/api/v2/accounts/${token}/jobs/${externalId}`);
      return stripHtml([d?.description, d?.requirements, d?.benefits].filter(Boolean).join("\n"));
    }
    case "bamboohr": {
      const d = await getJson(`https://${token}.bamboohr.com/careers/${externalId}/detail`);
      return stripHtml(d?.result?.jobOpening?.description ?? "");
    }
    case "breezy":
    case "join":
      // No public JSON detail — the job page's og:description carries the body.
      return ogDescription(await getHtml(url));
    default:
      return "";
  }
}

const PLATFORMS = ["sr:", "workday:", "workable:", "bamboohr:", "breezy:", "join:"];
const rows = await prisma.job.findMany({
  where: {
    delistedAt: null,
    duplicateOfId: null,
    // Store-all: never spend detail fetches on gate-rejected rows; if a
    // scorer fix requalifies them, they re-enter this queue on the next run.
    disqualified: false,
    OR: PLATFORMS.map((p) => ({ source: { startsWith: p } })),
  },
  orderBy: [{ sponsorReg: "desc" }, { score: "desc" }, { lastSeenAt: "desc" }],
  select: { id: true, source: true, externalId: true, url: true, title: true, company: true, location: true, remote: true, content: { select: { description: true } } },
});
const queue = rows.filter((r) => (r.content?.description ?? "").length < r.title.length + 60);
log(`=== desc:fill — ${queue.length} title-only ilan (toplam ${rows.length} aday içinden) ===`);

let done = 0;
let filled = 0;
let crossed = 0;
for (const r of queue) {
  if (done >= BUDGET) break;
  done++;
  const desc = await fetchDescription(r.source, r.externalId, r.url);
  if (desc.length >= r.title.length + 60) {
    const raw = {
      source: r.source, externalId: r.externalId, url: r.url, title: r.title,
      company: r.company, location: r.location ?? undefined, remote: r.remote,
      description: desc,
    };
    const s = scoreJob(raw);
    const newScore = s.disqualified ? 0 : s.score;
    // slice(0, 8000) can cut a surrogate pair in half — the lone half is
    // unserializable and killed the run mid-queue. Drop a trailing orphan.
    let stored = desc.slice(0, 8000);
    if (/[\uD800-\uDBFF]$/.test(stored)) stored = stored.slice(0, -1);
    await prisma.job.update({
      where: { id: r.id },
      data: {
        content: {
          upsert: { create: { description: stored }, update: { description: stored } },
        },
        score: newScore,
        track: s.track,
        scoreReason: s.reason,
        disqualified: s.disqualified,
        langReq: s.langReq || null,
        seniorityLevel: s.seniorityLevel === "unknown" ? null : s.seniorityLevel,
        seniorityBy: s.seniorityLevel === "unknown" ? null : "detector",
        workMode: deriveWorkMode(raw),
        visa: detectVisa(desc, r.title),
        scores: {
          create: {
            scorerVersion: SCORER_VERSION, score: newScore, track: s.track,
            reason: s.reason, disqualified: s.disqualified, at: new Date(),
          },
        },
      },
    });
    filled++;
    if (newScore > 50) crossed++;
  }
  if (done % 200 === 0) log(`  ${done}/${Math.min(queue.length, BUDGET)} işlendi — ${filled} metin geldi, ${crossed} ilan 50+ oldu`);
  await sleep(300);
}
log(`=== Bitti: ${done} denendi, ${filled} açıklama dolduruldu, ${crossed} ilan fit eşiğini aştı ===`);
await prisma.$disconnect();
