// Source health check: run every aggregator with tiny budgets and report
// which are broken. APIs rot quietly (freehire 504s, SwissDevJobs'
// documented endpoint died, Groq retired models) — with 25+ sources, a
// one-command checkup beats discovering breakage inside a real ingest.
//
//   npm run doctor        (LLM_DISABLE etc. from .env apply as usual)
//
// Budgets are forced down via env BEFORE the source modules load (they read
// config at import time) — that's why the imports below are dynamic.

export {}; // top-level await needs module context before the dynamic import

process.env.LINKEDIN_PAGES = "1";
process.env.LINKEDIN_TITLES = "software engineer"; // one search, not the 103-search matrix
process.env.LINKEDIN_CITIES = "Berlin, Germany";
process.env.LINKEDIN_COUNTRIES = "Germany";
process.env.LINKEDIN_DETAIL_MAX = "1";
process.env.BA_MAX_PAGES = "1";
process.env.BA_DETAIL_MAX = "1";
process.env.BA_SIZE = "5";
process.env.EURES_MAX_PAGES = "1";
process.env.EURES_LIMIT = "5";
process.env.EURES_COUNTRIES = "nl";
process.env.FREEHIRE_MAX_PAGES = "1";
process.env.FREEHIRE_LIMIT = "5";
process.env.SWEDEN_MAX_PAGES = "1";
process.env.DENMARK_MAX_PAGES = "1";
process.env.CH_MAX_PAGES = "1";
process.env.CH_DETAIL_MAX = "1";
process.env.VDAB_MAX_PAGES = "1";
process.env.POLAND_MAX_PAGES = "1";
process.env.THEHUB_MAX_PAGES = "1";
process.env.NICHE_MAX_PAGES = "1";
process.env.WTTJ_MAX_HITS = "5";
process.env.MANFRED_DETAIL_MAX = "1";
process.env.LANDINGJOBS_MAX_PAGES = "1";
process.env.ARBEITNOW_MAX_PAGES = "1";
process.env.HIMALAYAS_MAX_PAGES = "1";
process.env.HN_MAX_THREADS = "1";
process.env.JOBICY_INDUSTRIES = "dev";
process.env.ADZUNA_MAX_PAGES = "1";

const { aggregators } = await import("../../src/lib/ingest");

const KEYED = new Set(["adzuna", "jsearch", "indeed"]); // skip-if-no-key sources

let healthy = 0;
let broken = 0;
let empty = 0;
const failures: string[] = [];

for (const src of aggregators) {
  const t = Date.now();
  try {
    const jobs = await Promise.race([
      src.fetch(),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("doctor timeout (120s)")), 120_000)),
    ]);
    const secs = ((Date.now() - t) / 1000).toFixed(1);
    if (jobs.length > 0) {
      healthy++;
      console.log(`  ✓ ${src.name.padEnd(18)} ${String(jobs.length).padStart(4)} jobs  ${secs}s`);
    } else if (KEYED.has(src.name)) {
      console.log(`  - ${src.name.padEnd(18)}    0 jobs  (keyless skip — expected without API keys)`);
    } else {
      empty++;
      console.log(`  ∅ ${src.name.padEnd(18)}    0 jobs  ${secs}s — empty: outage, block, or contract drift`);
    }
  } catch (e: any) {
    broken++;
    failures.push(src.name);
    console.log(`  ✗ ${src.name.padEnd(18)} ERROR: ${String(e.message).slice(0, 90)}`);
  }
}

console.log(`\n${healthy} healthy, ${empty} suspicious-empty, ${broken} broken${failures.length ? ` (${failures.join(", ")})` : ""}`);

// STORED-DERIVATION AUDIT: does visaTier still equal what the evidence derives?
//
// The schema has claimed for months that "every write goes through
// applyVisaEvidence() and `npm run doctor` audits the invariant". Neither half
// was true — there is no function by that name, and this file had never touched
// the database. Meanwhile eight of eleven visa-touching writers bypassed the
// single writer, and a sweep of the live pool found 88 rows whose stored tier
// the current evidence does not produce: 30 of them wearing a sponsor badge on
// the radar with nothing behind it.
//
// A stored derivation is only safe if its drift can be SEEN. This is the seeing.
{
  const { prisma } = await import("../../src/lib/db");
  const { deriveVisaTier } = await import("../../src/lib/visa/visa");
  const { profile } = await import("../../src/lib/user/profile");
  const { liveWhere } = await import("../../src/lib/queue/pool");

  const rows = await prisma.job.findMany({
    where: liveWhere(),
    select: { visa: true, sponsorReg: true, source: true, country: true, visaTier: true },
  });
  const drift = rows.filter(
    (r) => deriveVisaTier(r, profile.workAuthorization) !== r.visaTier,
  ).length;
  await prisma.$disconnect();

  if (drift === 0) {
    console.log(`✓ visaTier: ${rows.length.toLocaleString("tr")} canlı ilanın tamamı kanıtıyla tutarlı`);
  } else {
    console.log(
      `✗ visaTier: ${drift.toLocaleString("tr")}/${rows.length.toLocaleString("tr")} ilan sapmış — düzeltmek için: npm run visa:retier`,
    );
  }
  // Drift is a data problem, not a broken source: report it, but let the exit
  // code keep meaning "a connector is down".
}

process.exit(broken > 0 ? 1 : 0);
