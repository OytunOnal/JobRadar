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

import { prisma } from "../../src/lib/db";
import { backfill } from "../../src/lib/queue/backfill";
import { derivedFields } from "../../src/lib/scoring/derive";
import { stripHtml } from "../../src/lib/sources/types";
import { labelledSections as labelled } from "../../src/lib/text/sections";
import { TEXT_VERSION } from "../../src/lib/text/html-text";
import { invalidateVector } from "../../src/lib/llm/embed";
import { andWhere, openWhere } from "../../src/lib/queue/pool";
import { chunkFromArgs, chunkWhere } from "../../src/lib/queue/chunks";
import { VISA_MARKED } from "../../src/lib/visa/visa";
import { fetchDetail as baDetail } from "../../src/lib/sources/arbeitsagentur";
import { fetchDetail as chDetail } from "../../src/lib/sources/switzerland";
import { fetchDetailSections as manfredSections } from "../../src/lib/sources/manfred";
import { fetchNoFluffDetail } from "../../src/lib/sources/poland";
import { fetchDetail as linkedinDetail } from "../../src/lib/sources/linkedin";

const UA = "Mozilla/5.0 (compatible; JobRadar/0.1; personal job search)";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

// Generic lane: schema.org JSON-LD JobPosting, the standard structured block
// most hosted career pages embed. One parser covers SF/BeeSite/Radancy/
// Softgarden/Avature/CSOD and future platforms without bespoke fetchers.
function jsonLdDescription(html: string): string {
  for (const m of html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(m[1]);
      const nodes = Array.isArray(data) ? data : data["@graph"] ?? [data];
      for (const n of nodes) {
        if (n && (n["@type"] === "JobPosting" || (Array.isArray(n["@type"]) && n["@type"].includes("JobPosting"))) && n.description) {
          return stripHtml(String(n.description));
        }
      }
    } catch { /* malformed block — try the next */ }
  }
  return "";
}

function ogDescription(html: string): string {
  const m = html.match(/property="og:description"\s+content="([\s\S]*?)"\s*\/?>/) ||
    html.match(/content="([\s\S]*?)"\s+property="og:description"/);
  return m ? stripHtml(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&")) : "";
}

// Per-platform detail fetch → plain-text description ("" = unavailable).
export async function fetchDescription(source: string, externalId: string, url: string): Promise<string> {
  const [platform, ...rest] = source.split(":");
  const token = rest.join(":");
  switch (platform) {
    case "sr": {
      const d = await getJson(`https://api.smartrecruiters.com/v1/companies/${token}/postings/${externalId}`);
      const s = d?.jobAd?.sections ?? {};
      return labelled([
        ["About the company", s.companyDescription?.text],
        ["Responsibilities", s.jobDescription?.text],
        ["Requirements", s.qualifications?.text],
        ["Additional information", s.additionalInformation?.text],
      ]);
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
      return labelled([
        ["", d?.description], // the intro carries no heading of its own
        ["Requirements", d?.requirements],
        ["Benefits", d?.benefits],
      ]);
    }
    case "bamboohr": {
      const d = await getJson(`https://${token}.bamboohr.com/careers/${externalId}/detail`);
      return stripHtml(d?.result?.jobOpening?.description ?? "");
    }
    case "breezy":
    case "join":
      // No public JSON detail — the job page's og:description carries the body.
      return ogDescription(await getHtml(url));
    case "rippling": {
      // Detail's description is an OBJECT of html sections (company/role/...)
      // — live-verified shape; join the section values.
      const d = await getJson(`https://api.rippling.com/platform/api/ats/v1/board/${token}/jobs/${externalId}`);
      const desc = d?.description;
      if (typeof desc === "string") return stripHtml(desc);
      if (desc && typeof desc === "object") {
        // The keys ARE the section names ("aboutUs", "theRole", ...).
        return labelled(Object.entries(desc).map(([k, v]) => [
          k.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase()),
          v,
        ]));
      }
      return "";
    }
    case "gem": {
      // Public GraphQL detail query (boardId = token, extId = externalId).
      try {
        const res = await fetch(`https://jobs.gem.com/api/public/graphql/batch?board=${token}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", batch: "true" },
          body: JSON.stringify([{
            operationName: "ExternalJobPostingQuery",
            variables: { boardId: token, extId: externalId },
            query: "query ExternalJobPostingQuery($boardId: String!, $extId: String!) { oatsExternalJobPosting(boardId: $boardId, extId: $extId) { descriptionHtml } }",
          }]),
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) return "";
        const d = await res.json();
        return stripHtml(d?.[0]?.data?.oatsExternalJobPosting?.descriptionHtml ?? "");
      } catch { return ""; }
    }
    case "oracle": {
      // CE details REST: full body in ExternalDescriptionStr + siblings.
      const m = token.match(/^([^@]+)@(.+)$/);
      if (!m) return "";
      const d = await getJson(
        `https://${m[1]}.oraclecloud.com/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails` +
        `?onlyData=true&expand=all&finder=ById;Id=%22${encodeURIComponent(externalId)}%22,siteNumber=${encodeURIComponent(m[2])}`,
      );
      const it = d?.items?.[0];
      // Oracle names each block; keep the names and put them in reading
      // order (the corporate blurb closes rather than opens the posting).
      return labelled([
        ["", it?.ExternalDescriptionStr],
        ["Responsibilities", it?.ExternalResponsibilitiesStr],
        ["Requirements", it?.ExternalQualificationsStr],
        ["About the company", it?.CorporateDescriptionStr],
      ]);
    }
    case "sf":
    case "beesite":
    case "radancy":
    case "softgarden":
    case "avature":
    case "csod":
    case "phenom":
    case "personio": {
      // HTML platforms: JSON-LD JobPosting first, og:description as fallback.
      const html = await getHtml(url);
      return jsonLdDescription(html) || ogDescription(html);
    }
    default:
    // ── Sources that used to fetch their own detail pages ──────────────
    //
    // Four connectors ran this same two-stage shape themselves: score every
    // card from its title, drop the ones under the gate, fetch detail pages
    // for the best N. That put a store decision inside a connector and a
    // detail budget in four places. They now return every card they see, and
    // the second stage is here — where the ordering is the STORED score, and
    // where a budget and a per-platform circuit breaker already exist.
    case "arbeitsagentur":
      return (await baDetail(externalId)).description ?? "";
    case "ch-jobroom":
      return (await chDetail(externalId)) ?? "";
    case "manfred":
      // Manfred names every block; assembled here, through the same helper
      // every other named source in this switch goes through.
      return labelled(await manfredSections(externalId));
    case "linkedin":
      return await linkedinDetail(externalId);
    case "nofluffjobs":
      return await fetchNoFluffDetail(externalId);
  }
}

// Prefixes, because an ATS source is "<platform>:<token>". The last four are
// whole source names: aggregators whose detail fetching moved here.
const PLATFORMS = ["sr:", "workday:", "workable:", "bamboohr:", "breezy:", "join:", "rippling:", "gem:", "oracle:", "sf:", "beesite:", "radancy:", "softgarden:", "avature:", "csod:", "phenom:", "personio:", "arbeitsagentur", "ch-jobroom", "manfred", "linkedin", "nofluffjobs"];

// A body short enough that the source is still holding the real one.
//
// The title-only test below does not catch these: Job-Room ships a ~200
// character preview and BA ships nothing at all, so a preview reads as a real
// body by length while being a tenth of one. Nor does the flat test, because
// ingest stamps the current TEXT_VERSION on every write.
const PREVIEW_SOURCES = new Set(["arbeitsagentur", "ch-jobroom", "manfred", "linkedin"]);
const PREVIEW_MAX = 600;

// The backfill runs only when this file is the entry point. Without the
// guard, importing fetchDescription — to check one platform's shape, or from
// a test — silently launches a full pool backfill, which is exactly what
// happened once.
const isEntryPoint = process.argv[1]?.replace(/\\/g, "/").endsWith("desc-fill.ts");

export async function main() {
 await backfill("desc-fill", { budget: 100_000 }, async (run) => {
const rows = await prisma.job.findMany({
  // openWhere: store-all means never spending detail fetches on gate-rejected
  // rows (a scorer fix re-enters them on the next run), and the status half
  // means never spending them on postings the user has dismissed — which this
  // queue used to do, because it constrained no status at all.
  // Lane scoping, same flags fit-fill and embed-fill take from the worker.
  // The worker summons this script when a judge lane defers title-only rows;
  // unscoped, a 30k-row queue could spend its whole budget before reaching
  // the 44 rows the lane is actually starving on.
  where: andWhere(
    openWhere(),
    { OR: PLATFORMS.map((p) => ({ source: { startsWith: p } })) },
    process.argv.includes("--visa-marked") ? VISA_MARKED : null,
    chunkWhere(chunkFromArgs(process.argv.slice(2))),
  ),
  orderBy: [{ sponsorReg: "desc" }, { score: "desc" }, { lastSeenAt: "desc" }],
  select: { id: true, source: true, externalId: true, url: true, title: true, company: true, location: true, remote: true, country: true, visa: true, visaBy: true, seniorityLevel: true, seniorityBy: true, workModeBy: true, sponsorReg: true, content: { select: { description: true, textVersion: true } } },
});
// Two reasons to fetch a posting's detail page.
//
//   1. TITLE-ONLY — the original reason. These platforms' LIST endpoints
//      carry no body at all, so the stored description is the title.
//   2. FLAT — the stored text has no line breaks. That is damage we did:
//      the old stripHtml collapsed \s+, so a rich HTML posting arrived as
//      one unbroken paragraph and the section parser has nothing to read.
//      Measured across the candidate pool, half the rows are in this state.
//
// The version stamp is what keeps case 2 from re-fetching forever. A row
// written by the current converter is left alone even if the SOURCE ships
// flat prose — some genuinely do, and re-asking them every run would burn
// hours to learn the same thing.
const queue = rows.filter((r) => {
  const d = r.content?.description ?? "";
  if (d.length < r.title.length + 60) return true;
  //   3. PREVIEW — the four sources whose detail fetching moved here ship a
  //      short teaser (or nothing) on the list endpoint. Long enough to pass
  //      the title-only test, short enough that the real body is still at the
  //      source. A successful fetch lifts it past this bar; a source whose
  //      real body IS this short costs one retry per run, which the
  //      per-platform circuit breaker bounds.
  if (PREVIEW_SOURCES.has(r.source.split(":")[0]) && d.length < PREVIEW_MAX) return true;
  return !d.includes("\n") && r.content?.textVersion !== TEXT_VERSION;
});
const titleOnly = queue.filter((r) => (r.content?.description ?? "").length < r.title.length + 60).length;
run.log(`=== desc:fill — ${queue.length} ilan (${titleOnly} gövdesiz, ${queue.length - titleOnly} yapısız) / ${rows.length} aday ===`);

let done = 0;
let filled = 0;
let crossed = 0;
// Per-platform outcomes. A run that spends hours on a platform whose detail
// endpoint is gone should say so rather than look like slow progress.
const tally = new Map<string, { tried: number; ok: number; flat: number }>();
// Platforms given up on for this run, and the miss streak that gets them there.
const broken = new Set<string>();
const misses = new Map<string, number>();
const BREAK_AFTER = 25;
let skipped = 0;
// A fixed snapshot walked once — no re-query, so nothing to consume and
// nothing that can spin. round() supplies the budget bound the loop used to
// carry itself.
for (const r of queue) {
  if (run.exhausted()) break;
  const plat0 = r.source.split(":")[0];
  // Circuit breaker. A platform that answers nothing — rate-limited, moved,
  // or retired — will answer nothing for the whole run, and a 31k-row queue
  // gives it thousands of chances to prove that. Workable made the case: 111
  // consecutive 429s in a sample of 250, which at this pace would have spent
  // half an hour of the run learning one fact. Stop asking, say so, move on.
  if (broken.has(plat0)) { skipped++; continue; }
  done++;
  run.did();
  const desc = await fetchDescription(r.source, r.externalId, r.url);
  const plat = r.source.split(":")[0];
  const t = tally.get(plat) ?? { tried: 0, ok: 0, flat: 0 };
  t.tried++;
  if (desc.length >= r.title.length + 60) { t.ok++; if (!desc.includes("\n")) t.flat++; }
  tally.set(plat, t);
  if (desc.length >= r.title.length + 60) {
    misses.set(plat, 0);
  } else {
    const m = (misses.get(plat) ?? 0) + 1;
    misses.set(plat, m);
    if (m >= BREAK_AFTER) {
      broken.add(plat);
      run.log(`   ! ${plat}: üst üste ${m} boş yanıt — bu koşuda atlanıyor`);
    }
  }
  if (desc.length >= r.title.length + 60) {
    const raw = {
      source: r.source, externalId: r.externalId, url: r.url, title: r.title,
      company: r.company, location: r.location ?? undefined, remote: r.remote,
      description: desc,
    };
    // The body we just fetched IS the kept text — that is the whole point of
    // this pass — so every derived field follows it. This block used to list
    // those fields by hand and had drifted from the other three writers in
    // three ways: no seniority guard (so it demoted LLM levels), only half the
    // store gate, and a raw `visa` write that bypassed the single-writer rule.
    const country = r.country ?? null;
    const current = {
      visa: r.visa, visaBy: r.visaBy,
      seniorityLevel: r.seniorityLevel, seniorityBy: r.seniorityBy,
      workModeBy: r.workModeBy,
      sponsorReg: r.sponsorReg, source: r.source, country,
    };
    const fields = derivedFields(raw, { country, sponsorReg: r.sponsorReg, current });
    const newScore = fields.score;
    // slice(0, 8000) can cut a surrogate pair in half — the lone half is
    // unserializable and killed the run mid-queue. Drop a trailing orphan.
    let stored = desc.slice(0, 8000);
    if (/[\uD800-\uDBFF]$/.test(stored)) stored = stored.slice(0, -1);
    await prisma.job.update({
      where: { id: r.id },
      data: {
        content: {
          upsert: {
            create: { description: stored, textVersion: TEXT_VERSION },
            update: { description: stored, textVersion: TEXT_VERSION },
          },
        },
        ...fields,
      },
    });
    // The vector described the text we just replaced.
    await invalidateVector(prisma, r.id);
    filled++;
    if (newScore > 50) crossed++;
  }
  if (done % 200 === 0) run.log(`  ${done}/${queue.length} işlendi — ${filled} metin geldi, ${crossed} ilan 50+ oldu`);
  await sleep(300);
}
run.drained();
run.log(`${done} denendi, ${filled} açıklama dolduruldu, ${crossed} ilan fit eşiğini aştı` + (skipped ? `, ${skipped} atlandı (${[...broken].join(",")})` : ""));
for (const [plat, t] of [...tally].sort((a, b) => b[1].tried - a[1].tried)) {
  const pc = (n: number) => `${Math.round((n / t.tried) * 100)}%`;
  run.log(`   ${plat.padEnd(12)} denendi ${String(t.tried).padStart(5)} | metin geldi ${pc(t.ok).padStart(4)} | gelen ama hâlâ düz ${t.ok ? Math.round((t.flat / t.ok) * 100) : 0}%`);
}
 });
}

if (isEntryPoint) await main();
