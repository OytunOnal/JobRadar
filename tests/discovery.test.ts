import { test } from "node:test";
import assert from "node:assert/strict";
import { extractSlug, hostCollisions } from "../src/lib/discovery/extract";
import { getPlatform } from "../src/lib/discovery/platforms";

// Fixtures are real URLs: sampled from the Common Crawl CDX dumps
// (CC-MAIN-2026-30) and from this project's own ingest database — not invented.

function hit(url: string) {
  const h = extractSlug(url);
  assert.ok(h, `expected a slug from ${url}`);
  return h;
}

// ── Greenhouse: happy paths ──────────────────────────────────────────────────

test("greenhouse: classic boards.greenhouse.io job URL", () => {
  const h = hit("https://boards.greenhouse.io/snagajob/jobs/2388821");
  assert.equal(h.platform, "greenhouse");
  assert.equal(h.token, "snagajob");
  assert.equal(h.region, "");
});

test("greenhouse: tracking query junk does not affect the slug", () => {
  const h = hit(
    "https://boards.greenhouse.io/andurilindustries/jobs/5072529007?utm_source=General+Catalyst+job+board&utm_medium=getro.com&gh_src=General+Catalyst+job+board",
  );
  assert.equal(h.token, "andurilindustries");
});

test("greenhouse: gh_jid query param is not mistaken for a slug source", () => {
  const h = hit(
    "https://boards.greenhouse.io/veterinarypracticepartners/jobs/8622459002?gh_jid=8622459002",
  );
  assert.equal(h.token, "veterinarypracticepartners");
});

test("greenhouse: new job-boards domain (from our own DB)", () => {
  const h = hit("https://job-boards.greenhouse.io/goodjobgames/jobs/4221785003");
  assert.equal(h.token, "goodjobgames");
  assert.equal(h.region, "");
});

test("greenhouse: EU hosts carry region metadata", () => {
  const a = hit("https://job-boards.eu.greenhouse.io/abbyy/jobs/4567");
  assert.equal(a.token, "abbyy");
  assert.equal(a.region, "eu");
  const b = hit("https://boards.eu.greenhouse.io/acrolinx");
  assert.equal(b.region, "eu");
});

test("greenhouse: embed career-site widget exposes the slug via ?for=", () => {
  const h = hit("https://boards.greenhouse.io/embed/job_app?for=peak&token=4000000");
  assert.equal(h.platform, "greenhouse");
  assert.equal(h.token, "peak");
});

test("greenhouse: bare board root URL works", () => {
  const h = hit("https://boards.greenhouse.io/wooga");
  assert.equal(h.token, "wooga");
});

// ── Canonicalization ─────────────────────────────────────────────────────────

test("slug is lowercased; dedupeToken always lowercase", () => {
  const h = hit("https://BOARDS.greenhouse.io/PeakGames/jobs/1");
  assert.equal(h.token, "peakgames");
  assert.equal(h.dedupeToken, "peakgames");
});

// ── Rejections ───────────────────────────────────────────────────────────────

test("rejects infrastructure and file segments", () => {
  assert.equal(extractSlug("https://boards.greenhouse.io/robots.txt"), null);
  assert.equal(extractSlug("https://boards.greenhouse.io/favicon.ico"), null);
  // /embed without ?for= yields nothing (path pattern denies, query pattern has no param)
  assert.equal(extractSlug("https://boards.greenhouse.io/embed/job_app"), null);
  assert.equal(extractSlug("https://boards.greenhouse.io/api/something"), null);
});

test("rejects version segments but keeps real v-names", () => {
  assert.equal(extractSlug("https://boards.greenhouse.io/v1/boards"), null);
  // job-hunter's discovery rejects every v-prefixed slug — that would lose
  // vercel/voodoo. Ours must not.
  assert.equal(hit("https://boards.greenhouse.io/vercel").token, "vercel");
});

test("rejects percent-encoded junk (real Wayback record)", () => {
  // Ligature garbage seen in the Wayback CDX for Lever; decodes to non-ASCII.
  assert.equal(
    extractSlug("https://boards.greenhouse.io/%EF%AC%81n%EF%AC%81t/90c1cd87"),
    null,
  );
});

test("rejects root, unknown hosts, and non-http schemes", () => {
  assert.equal(extractSlug("https://boards.greenhouse.io/"), null);
  assert.equal(extractSlug("https://greenhouse.io/customers"), null); // marketing site
  assert.equal(extractSlug("https://jobs.some-unknown-ats.io/acme"), null); // unknown platform
  assert.equal(extractSlug("ftp://boards.greenhouse.io/wooga"), null);
  assert.equal(extractSlug("not a url"), null);
});

// ── Lever ────────────────────────────────────────────────────────────────────

test("lever: US board URL (from our own DB)", () => {
  const h = hit("https://jobs.lever.co/dreamgames/ddd317b1-11f6-4477-9ca0-d35dd0a279fe");
  assert.equal(h.platform, "lever");
  assert.equal(h.token, "dreamgames");
  assert.equal(h.region, "");
});

test("lever: EU instance carries region (real Common Crawl records)", () => {
  const h = hit("https://jobs.eu.lever.co/abzena/841a353a-a533-4fcd-a978-642db520622f");
  assert.equal(h.token, "abzena");
  assert.equal(h.region, "eu");
  // /apply suffix and tracking params don't change the slug
  const a = hit(
    "https://jobs.eu.lever.co/amicustherapeutics/07331f63-506e-4c94-9b18-3112561611ea/apply",
  );
  assert.equal(a.token, "amicustherapeutics");
});

test("lever: querystring junk on EU URLs (real CC record)", () => {
  const h = hit(
    "https://jobs.eu.lever.co/aavelabs/1edc70fd-91dc-41c8-99df-dcd7cb7dfd41?utm_source=itsnftime.metaventis.io&utm_medium=referral",
  );
  assert.equal(h.token, "aavelabs");
  assert.equal(h.region, "eu");
});

test("lever: rejects Wayback ligature junk and glued-URL records", () => {
  // Both are real (broken) records from the Wayback CDX dump for jobs.lever.co.
  assert.equal(
    extractSlug("https://jobs.lever.co/%EF%AC%81n%EF%AC%81t/90c1cd87-d8f5-4a61-9461-0128ba984034"),
    null,
  );
  assert.equal(
    extractSlug(
      "https://jobs.lever.co/%EF%AC%81n%EF%AC%81t/90c1cd87-d8f5-4a61-9461-0128ba984034https://careers.unitedhealthgroup.com/job/20483013/",
    ),
    null,
  );
});

// ── Ashby ────────────────────────────────────────────────────────────────────

test("ashby: plain board and posting URLs (from our own DB + CC corpus)", () => {
  const h = hit("https://jobs.ashbyhq.com/openai/43174eb6-0ffe-4744-9323-c7969e7ea2e1");
  assert.equal(h.platform, "ashby");
  assert.equal(h.token, "openai");
  const a = hit("https://jobs.ashbyhq.com/10xteam/197210fb-4c11-4dee-a36a-2ab5ac4f8879/application?utm_id=12275809&utm_source=Workreap");
  assert.equal(a.token, "10xteam");
});

test("ashby: uppercase tokens canonicalize to lowercase (API is case-insensitive)", () => {
  const h = hit("https://jobs.ashbyhq.com/Crusoe/some-posting");
  assert.equal(h.token, "crusoe");
  assert.equal(h.dedupeToken, "crusoe");
});

test("ashby: real tokens with dots and encoded spaces (verified live, all 200)", () => {
  assert.equal(hit("https://jobs.ashbyhq.com/kraken.com").token, "kraken.com");
  assert.equal(hit("https://jobs.ashbyhq.com/jerry.ai/a1b2").token, "jerry.ai");
  const h = hit("https://jobs.ashbyhq.com/Tools%20for%20Humanity/5678");
  assert.equal(h.token, "tools for humanity");
});

test("ashby: dot-friendly rule must still reject web files and junk", () => {
  assert.equal(extractSlug("https://jobs.ashbyhq.com/robots.txt"), null);
  assert.equal(extractSlug("https://jobs.ashbyhq.com/favicon.ico"), null);
  assert.equal(extractSlug("https://jobs.ashbyhq.com/api/foo"), null);
  // non-ASCII decoded junk fails even the loose rule
  assert.equal(extractSlug("https://jobs.ashbyhq.com/%EF%AC%81n%EF%AC%81t/x"), null);
});

test("ashby: probe URL percent-encodes loose tokens", () => {
  const ashby = getPlatform("ashby")!;
  assert.equal(
    ashby.probeUrl("tools for humanity", ""),
    "https://api.ashbyhq.com/posting-api/job-board/tools%20for%20humanity",
  );
  assert.equal(
    ashby.probeUrl("kraken.com", ""),
    "https://api.ashbyhq.com/posting-api/job-board/kraken.com",
  );
});

// ── SmartRecruiters ──────────────────────────────────────────────────────────

test("smartrecruiters: job URLs on both hosts (real CC records)", () => {
  const h = hit("https://jobs.smartrecruiters.com/BoschGroup/743999739807756-assistente-de-meios-de-producao?trid=1d68fb86");
  assert.equal(h.platform, "smartrecruiters");
  assert.equal(h.token, "boschgroup"); // API verified case-insensitive
  const c = hit("https://careers.smartrecruiters.com/2NTELEKOMUNIKACEAs/cz-vyberovy-proces");
  assert.equal(c.token, "2ntelekomunikaceas");
});

test("smartrecruiters: long CamelCase tokens fit the default rule", () => {
  const h = hit("https://jobs.smartrecruiters.com/REWEInternationalDienstleistungsgesellschaftmbH/744000-x");
  assert.equal(h.token, "reweinternationaldienstleistungsgesellschaftmbh");
});

test("smartrecruiters: rejects web files", () => {
  assert.equal(extractSlug("https://jobs.smartrecruiters.com/robots.txt"), null);
});

test("smartrecruiters: probeAlive requires totalFound > 0 (API 200s for any name)", () => {
  const sr = getPlatform("smartrecruiters")!;
  assert.equal(
    sr.probeUrl("gameloft", ""),
    "https://api.smartrecruiters.com/v1/companies/gameloft/postings?limit=1",
  );
  // Real response shapes observed live:
  assert.equal(sr.probeAlive!(200, { offset: 0, limit: 1, totalFound: 54, content: [{}] }), true);
  assert.equal(sr.probeAlive!(200, { offset: 0, limit: 1, totalFound: 0, content: [] }), false);
  assert.equal(sr.probeAlive!(404, { totalFound: 5 }), false);
  assert.equal(sr.probeAlive!(200, null), false);
});

// ── Workable ─────────────────────────────────────────────────────────────────

test("workable: board and job URLs (real CC records)", () => {
  const h = hit("https://apply.workable.com/gamigo/");
  assert.equal(h.platform, "workable");
  assert.equal(h.token, "gamigo");
  // Slug survives even when the path continues into a /j/ shortlink
  assert.equal(hit("https://apply.workable.com/1000heads/j/1C58976675").token, "1000heads");
  // Long hyphenated slugs fit the default rule
  assert.equal(
    hit("https://apply.workable.com/alliance-for-clinical-trial-in-oncology-foundation/").token,
    "alliance-for-clinical-trial-in-oncology-foundation",
  );
});

test("workable: bare /j/ shortlinks carry no slug and are denied", () => {
  assert.equal(extractSlug("https://apply.workable.com/j/4C21C8E4A3"), null);
});

test("workable: dead-account redirect marker still yields the slug (probe decides)", () => {
  assert.equal(hit("https://apply.workable.com/commify/?not_found=true").token, "commify");
});

test("workable: legacy subdomain boards extract via the subdomain pattern", () => {
  const h = hit("https://gamigo.workable.com/");
  assert.equal(h.platform, "workable");
  assert.equal(h.token, "gamigo");
  // Infrastructure labels are not slugs
  assert.equal(extractSlug("https://www.workable.com/pricing"), null);
  assert.equal(extractSlug("https://help.workable.com/hc/en-us"), null);
  // Nested subdomains are infrastructure, never boards
  assert.equal(extractSlug("https://cdn.assets.workable.com/x"), null);
});

test("workable: probe URL targets the widget API (case-sensitive, lowercase canonical)", () => {
  const w = getPlatform("workable")!;
  assert.equal(w.probeUrl("gamigo", ""), "https://apply.workable.com/api/v1/widget/accounts/gamigo");
  // API verified case-sensitive: uppercase URLs must canonicalize to lowercase
  assert.equal(hit("https://apply.workable.com/GAMIGO/").token, "gamigo");
});

// ── Recruitee ────────────────────────────────────────────────────────────────

test("recruitee: company subdomains carry the token (real CC records)", () => {
  const h = hit("https://8advisory.recruitee.com/o/real-estate-analyst-2-3?lang=fr");
  assert.equal(h.platform, "recruitee");
  assert.equal(h.token, "8advisory");
  assert.equal(hit("https://60secondstonapoli.recruitee.com/").token, "60secondstonapoli");
  assert.equal(hit("https://1x.recruitee.com/o/backend-dev").token, "1x");
  // Host carries the token — even a robots.txt path is still the board
  assert.equal(hit("https://picard.recruitee.com/robots.txt").token, "picard");
});

test("recruitee: infrastructure labels, apex, and nested subdomains are not boards", () => {
  assert.equal(extractSlug("https://support.recruitee.com/fr/articles/1066285-x"), null);
  assert.equal(extractSlug("https://www.recruitee.com/"), null);
  assert.equal(extractSlug("https://recruitee.com/pricing"), null); // apex = marketing site
  assert.equal(extractSlug("https://cdn.foo.recruitee.com/asset.js"), null); // nested
});

test("recruitee: probe URL puts the token in host position", () => {
  const r = getPlatform("recruitee")!;
  assert.equal(r.probeUrl("8advisory", ""), "https://8advisory.recruitee.com/api/offers/");
});

// ── Personio ─────────────────────────────────────────────────────────────────

test("personio: two-label suffix on both TLDs, same token (real CC records)", () => {
  const de = hit("https://partscloud.jobs.personio.de/job/2645949?language=null");
  assert.equal(de.platform, "personio");
  assert.equal(de.token, "partscloud");
  assert.equal(de.region, ""); // namespaces are mirrored — no region tracking
  const com = hit("https://intigriti.jobs.personio.com/job/2082755?language=en");
  assert.equal(com.token, "intigriti");
  assert.equal(hit("https://roesberg-engineering-gmbh.jobs.personio.de/job/544342").token,
    "roesberg-engineering-gmbh");
});

test("personio: suffix must match exactly — bare personio domains are not boards", () => {
  assert.equal(extractSlug("https://www.personio.de/"), null);
  assert.equal(extractSlug("https://personio.com/pricing"), null);
  assert.equal(extractSlug("https://www.jobs.personio.de/"), null); // deny label
  assert.equal(extractSlug("https://x.y.jobs.personio.com/"), null); // nested
});

test("personio: probe targets the canonical .com XML feed", () => {
  const p = getPlatform("personio")!;
  assert.equal(p.probeUrl("intigriti", ""), "https://intigriti.jobs.personio.com/xml");
});

// ── Workday ──────────────────────────────────────────────────────────────────

test("workday: structured token from the myworkdayjobs shape (real CC records)", () => {
  const h = hit("https://gapinc.wd1.myworkdayjobs.com/en-US/GAPINC/job/Seasonal-Retail-Sales-Associate_R184991");
  assert.equal(h.platform, "workday");
  assert.equal(h.token, "gapinc@wd1/gapinc"); // site verified case-insensitive
  // Without a locale segment, and with deeper /job/.../apply paths
  assert.equal(hit("https://cardinalhealth.wd1.myworkdayjobs.com/EXT/job/NJ-Swedesboro/Warehouse-Associate_20180").token,
    "cardinalhealth@wd1/ext");
  assert.equal(hit("https://carmax.wd1.myworkdayjobs.com/External/job/VA---Dulles/Class-A-Driver_JR-169654/apply").token,
    "carmax@wd1/external");
  // Site-only career page root
  assert.equal(hit("https://ferguson.wd1.myworkdayjobs.com/Ferguson_Experienced").token,
    "ferguson@wd1/ferguson_experienced");
});

test("workday: myworkdaysite shape converges to the same canonical token", () => {
  const h = hit("https://wd1.myworkdaysite.com/de-DE/recruiting/abinbev/EUR/job/Germany-Bremen/Duales-Studium_30086108");
  assert.equal(h.token, "abinbev@wd1/eur");
  assert.equal(hit("https://wd1.myworkdaysite.com/de-DE/recruiting/tjx/TJX_EXTERNAL/job/X/Y_R2328477").token,
    "tjx@wd1/tjx_external");
});

test("workday: infrastructure paths and incomplete URLs yield nothing", () => {
  assert.equal(extractSlug("https://gapinc.wd1.myworkdayjobs.com/"), null);
  assert.equal(extractSlug("https://gapinc.wd1.myworkdayjobs.com/en-US/"), null);
  assert.equal(extractSlug("https://gapinc.wd1.myworkdayjobs.com/wday/cxs/gapinc/GAPINC/jobs"), null);
  assert.equal(extractSlug("https://wd1.myworkdaysite.com/de-DE/recruiting"), null);
  assert.equal(extractSlug("https://www.myworkdayjobs.com/"), null); // no tenant.wdN shape
});

test("workday: probe is a POST to the canonical cxs endpoint", () => {
  const w = getPlatform("workday")!;
  assert.equal(
    w.probeUrl("abinbev@wd1/eur", ""),
    "https://abinbev.wd1.myworkdayjobs.com/wday/cxs/abinbev/eur/jobs",
  );
  assert.equal(w.probeRequest?.method, "POST");
  assert.ok(w.probeRequest?.body?.includes('"limit":1'));
});

// ── Parked platforms (discover-only, no fetcher yet) ─────────────────────────

test("bamboohr: subdomain boards; documentation/www are infra (real CC records)", () => {
  const h = hit("https://ehealthafrica.bamboohr.com/careers/list");
  assert.equal(h.platform, "bamboohr");
  assert.equal(h.token, "ehealthafrica");
  assert.equal(extractSlug("https://documentation.bamboohr.com/docs"), null);
  assert.equal(extractSlug("https://www.bamboohr.com/pricing"), null);
  assert.equal(getPlatform("bamboohr")!.probeUrl("c40", ""), "https://c40.bamboohr.com/careers/list");
});

test("breezy: subdomain boards with /p/ job paths (real CC records)", () => {
  const h = hit("https://blue-raven-solar.breezy.hr/p/85a5347bb7ae-solar-appointment-setter");
  assert.equal(h.platform, "breezy");
  assert.equal(h.token, "blue-raven-solar");
  assert.equal(extractSlug("https://app.breezy.hr/signin"), null);
  assert.equal(extractSlug("https://breezy.hr/robots.txt"), null); // apex
});

test("teamtailor: hosted-subdomain minority; infra labels denied (real CC records)", () => {
  const h = hit("https://huaweidusseldorf-1719303222.teamtailor.com/jobs/123");
  assert.equal(h.platform, "teamtailor");
  assert.equal(h.token, "huaweidusseldorf-1719303222");
  assert.equal(extractSlug("https://app.teamtailor.com/companies/x/dashboard"), null);
  assert.equal(extractSlug("https://integrations.teamtailor.com/enboarder"), null);
});

test("join: prefix-gated path tokens (real CC records)", () => {
  const h = hit("https://join.com/companies/nextcloud/16337591-back-end-engineer");
  assert.equal(h.platform, "join");
  assert.equal(h.token, "nextcloud");
  assert.equal(hit("https://join.com/companies/sallyswelt").token, "sallyswelt");
  // Off-prefix marketing pages are not slugs
  assert.equal(extractSlug("https://join.com/recruitment-software"), null);
  assert.equal(extractSlug("https://join.com/es/pricing"), null);
  assert.equal(extractSlug("https://join.com/companies"), null); // prefix root
});

test("every platform has a fetcher — the parked era is over", () => {
  // The formerly parked four (26.8k accumulated boards) plus pinpoint got
  // fetchers in the career-ops provider wave; nothing accumulates unfetched.
  for (const id of ["bamboohr", "breezy", "teamtailor", "join", "pinpoint"]) {
    assert.equal(typeof getPlatform(id)!.fetcher, "string", id);
  }
});

test("lever: probe URL is region-aware (namespaces verified separate)", () => {
  const lever = getPlatform("lever")!;
  assert.equal(lever.probeUrl("dreamgames", ""), "https://api.lever.co/v0/postings/dreamgames?mode=json");
  assert.equal(lever.probeUrl("abzena", "eu"), "https://api.eu.lever.co/v0/postings/abzena?mode=json");
  const gh = getPlatform("greenhouse")!;
  assert.equal(gh.probeUrl("abbyy", "eu"), "https://boards-api.greenhouse.io/v1/boards/abbyy");
});

// ── Registry invariants ──────────────────────────────────────────────────────

test("no host is claimed by two platforms", () => {
  assert.deepEqual(hostCollisions(), []);
});

// ── Oracle Cloud Recruiting ──────────────────────────────────────────────────

test("oracle: structured token from CandidateExperience URLs (live-verified shape)", () => {
  const h = hit("https://eeho.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_45001/job/343709");
  assert.equal(h.platform, "oracle");
  assert.equal(h.token, "eeho.fa.us2@cx_45001");
  // Requisition list page and localized site
  assert.equal(hit("https://hcpd.fa.em2.oraclecloud.com/hcmUI/CandidateExperience/de/sites/CX_1/requisitions").token,
    "hcpd.fa.em2@cx_1");
});

test("oracle: non-career oraclecloud paths yield nothing", () => {
  assert.equal(extractSlug("https://eeho.fa.us2.oraclecloud.com/"), null);
  assert.equal(extractSlug("https://eeho.fa.us2.oraclecloud.com/hcmRestApi/resources/latest/x"), null);
  assert.equal(extractSlug("https://docs.oraclecloud.com/en/sites/foo"), null); // no hcmUI prefix
});

test("oracle: probe URL embeds the site in the finder; liveness needs a non-empty list", () => {
  const p = getPlatform("oracle")!;
  assert.ok(p.probeUrl("eeho.fa.us2@cx_45001", "").includes("siteNumber=cx_45001"));
  // Unknown sites still answer 200 with the default site's jobs (verified
  // live) — an empty requisitionList is the only dead signal.
  assert.equal(p.probeAlive!(200, { items: [{ requisitionList: [] }] }), false);
  assert.equal(p.probeAlive!(200, { items: [{ requisitionList: [{ Id: 1 }] }] }), true);
  assert.equal(p.probeAlive!(404, { items: [{ requisitionList: [{ Id: 1 }] }] }), false);
});
